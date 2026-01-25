const db = require('../config/db');

const getStockItems = async (req, res) => {
    try {
        // Query kompleks ini menggunakan UNION ALL untuk menggabungkan Drone & Aksesoris
        // Serta JSON_AGG untuk menyusun array (images, bundles, links) langsung dari database.

        const query = `
      SELECT 
        d.id,
        dm.model_name as name,
        d.serial_number,
        d.status,
        d.condition,
        d.condition_score,
        'Drone' as type,
        d.purchase_price::float as modal_price,
        d.est_sell_price::float as est_sell_price,
        d.notes,
        d.created_at,
        
        -- Subquery: Images
        COALESCE((
          SELECT json_agg(image_url)
          FROM item_images 
          WHERE item_id = d.id AND item_type = 'Drone'
        ), '[]') as image_urls,

        -- Subquery: Marketplace Links
        COALESCE((
          SELECT json_agg(json_build_object('platform', platform, 'url', url))
          FROM marketplace_links 
          WHERE item_id = d.id AND item_type = 'Drone'
        ), '[]') as marketplace_links,

        -- Subquery: Bundle Items (Khusus Drone)
        COALESCE((
          SELECT json_agg(json_build_object(
            'name', acc.name,
            'sn', ai.serial_number,
            'cond', ai.condition,
            'score', ai.condition_score,
            'status', ai.status,
            'note', ai.notes,
            'buy', ai.purchase_price::float,  
            'sell', ai.est_sell_price::float  
          ))
          FROM accessory_items ai
          JOIN accessories acc ON ai.accessory_id = acc.id
          WHERE ai.drone_id = d.id
        ), '[]') as bundle_items

      FROM drones d
      JOIN drone_models dm ON d.model_id = dm.id
      WHERE d.status != 'Sold' -- Opsi: Sembunyikan yang sudah terjual dari list utama

      UNION ALL

      SELECT 
        ai.id,
        acc.name,
        ai.serial_number,
        ai.status,
        ai.condition,
        ai.condition_score,
        'Accessory' as type,
        ai.purchase_price::float as modal_price,
        ai.est_sell_price::float as est_sell_price,
        ai.notes,
        ai.created_at,

        -- Subquery: Images
        COALESCE((
          SELECT json_agg(image_url)
          FROM item_images 
          WHERE item_id = ai.id AND item_type = 'Accessory'
        ), '[]') as image_urls,

        -- Subquery: Marketplace Links
        COALESCE((
          SELECT json_agg(json_build_object('platform', platform, 'url', url))
          FROM marketplace_links 
          WHERE item_id = ai.id AND item_type = 'Accessory'
        ), '[]') as marketplace_links,

        -- Bundle Items (Aksesoris tidak punya bundle anak)
        '[]'::json as bundle_items

      FROM accessory_items ai
      JOIN accessories acc ON ai.accessory_id = acc.id
      WHERE ai.drone_id IS NULL AND ai.status != 'Sold' -- Hanya ambil aksesoris lepasan (bukan bundle)

      ORDER BY created_at DESC;
    `;

        const result = await db.query(query);

        // Hasil query sudah dalam format JSON yang pas untuk Flutter
        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// --- 1. CREATE STOCK (POST) ---
const createStock = async (req, res) => {
    // Multer SUDAH bekerja di sini
    console.log("--------------------------------------------------");
    console.log("DEBUG: ISI REQ.BODY (Text Fields):");
    console.log(req.body);

    console.log("DEBUG: ISI REQ.FILES (Gambar):");
    console.log(req.files);
    console.log("--------------------------------------------------");

    const client = await db.pool.connect(); // Gunakan transaction
    try {
        await client.query('BEGIN');

        // Data dikirim via form-data, jadi perlu diparse
        // req.body berisi field text, req.files berisi gambar
        const {
            type, model_id, name, serial_number, condition, condition_score,
            status, modal_price, est_sell_price, notes,
            marketplace_links, bundle_items
        } = req.body;

        let itemId; // ID dari item utama (Drone / Aksesoris Utama)
        let createdBundleObjects = []; // Array untuk menampung ID & Harga bundle yang baru diinsert
        let totalPurchaseAmount = parseFloat(modal_price); // Inisialisasi Total dengan Harga Utama

        // A. INSERT KE TABEL UTAMA (DRONES / ACCESSORY_ITEMS)
        if (type === 'Drone') {
            const droneRes = await client.query(`
        INSERT INTO drones (model_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
      `, [model_id, serial_number, modal_price, est_sell_price, status, condition, condition_score || null, notes]);
            itemId = droneRes.rows[0].id;

            // B. INSERT BUNDLE ITEMS (Jika Ada)
            if (bundle_items) {
                const bundles = JSON.parse(bundle_items); // Parse JSON String
                for (const b of bundles) {
                    // Pastikan 'buy' (modal) ada nilainya
                    const bundleBuyPrice = parseFloat(b.buy || 0);

                    const bundleRes = await client.query(`INSERT INTO accessory_items 
                    (drone_id, accessory_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                  `, [
                        itemId,           // drone_id (Parent)
                        b.acc_model_id,   // accessory_id (dari object acc_model)
                        b.sn,
                        bundleBuyPrice,
                        b.sell,
                        b.status || status,
                        b.cond || condition,
                        b.score || null,
                        b.note
                    ]);
                    // Simpan ID dan Harga bundle untuk keperluan Transaksi nanti
                    createdBundleObjects.push({
                        id: bundleRes.rows[0].id,
                        price: bundleBuyPrice
                    });

                    // Tambahkan ke Total Transaksi
                    totalPurchaseAmount += bundleBuyPrice;
                }
            }

        } else {
            // --- LOGIC UNTUK ACCESSORY UTAMA (Standalone) ---

            // Kita insert ke tabel accessory_items dengan drone_id = NULL
            const accRes = await client.query(`
        INSERT INTO accessory_items 
        (accessory_id, drone_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
                model_id,                 // $1: ID dari katalog accessories (dikirim sbg model_id dari FE)
                serial_number,            // $2
                modal_price,              // $3
                est_sell_price,           // $4
                status,                   // $5
                condition,                // $6
                condition_score || null,  // $7: Jika 'Baru', score biasanya null/undefined
                notes                     // $8
            ]);

            itemId = accRes.rows[0].id;
        }

        // C. INSERT MARKETPLACE LINKS
        if (marketplace_links) {
            const links = JSON.parse(marketplace_links);
            for (const link of links) {
                if (link.url && link.platform) {
                    await client.query(`

            INSERT INTO marketplace_links (item_type, item_id, platform, url)
            VALUES ($1, $2, $3, $4)
          `, [type, itemId, link.platform, link.url]);
                }
            }
        }

        // D. HANDLE IMAGE UPLOAD (Files dari Multer)
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                // Di Real production, upload file ke Cloud (S3/Cloudinary) lalu simpan URL-nya.
                // Untuk lokal, kita simpan path statis, misal: http://localhost:3000/uploads/filename.jpg

                // Sesuaikan dengan domain/IP komputer Anda
                const imageUrl = `http://10.0.2.2:3000/uploads/${file.filename}`;

                await client.query(`
          INSERT INTO item_images (item_type, item_id, image_url)
          VALUES ($1, $2, $3)
        `, [type, itemId, imageUrl]);
            }
        }

        // --- C. LOGIC BARU: INSERT PURCHASE TRANSACTION ---

        // 1. Insert Header Transaksi
        const trxHeaderRes = await client.query(`
      INSERT INTO transactions (type, date, total_price, notes)
      VALUES ('PURCHASE', NOW(), $1, $2)
      RETURNING id
    `, [
            totalPurchaseAmount,
            `Pembelian Stok Baru: ${name} (${serial_number})`
        ]);

        const transactionId = trxHeaderRes.rows[0].id;

        // 2. Insert Transaction Item (Untuk ITEM UTAMA / Body)
        await client.query(`
      INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
      VALUES ($1, $2, $3, $4, 1)
    `, [transactionId, type, itemId, parseFloat(modal_price)]);

        // 3. Insert Transaction Items (Untuk BUNDLE ITEMS - Jika Drone)
        if (createdBundleObjects.length > 0) {
            for (const bundleObj of createdBundleObjects) {
                await client.query(`
          INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
          VALUES ($1, 'Accessory', $2, $3, 1)
        `, [transactionId, bundleObj.id, bundleObj.price]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Stok dan Transaksi Pembelian berhasil disimpan', id: itemId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// --- 2. DELETE STOCK (DELETE) ---
const deleteStock = async (req, res) => {
    const { id } = req.params;
    const { type } = req.query; // Kirim type via query param ?type=Drone

    try {
        const table = type === 'Drone' ? 'drones' : 'accessory_items';
        const result = await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]);

        if (result.rowCount === 0) return res.status(404).json({ message: 'Item tidak ditemukan' });
        res.json({ message: 'Item berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 3. UPDATE STOCK (PUT) ---
const updateStock = async (req, res) => {
    // Logic mirip Create, tapi gunakan UPDATE ... WHERE id = ...
    // Untuk simplifikasi, implementasikan update field utama dulu
    res.json({ message: "Fitur Update (Logic Pending)" });
};

module.exports = { createStock, deleteStock, updateStock, getStockItems };

