const db = require('../config/db');
const uploadToImgBB = require("../libraries/imageUploader");

const getStockItems = async (req, res) => {
    try {
        // Query kompleks ini menggunakan UNION ALL untuk menggabungkan Drone & Aksesoris
        // Serta JSON_AGG untuk menyusun array (images, bundles, links) langsung dari database.

        const query = `
            SELECT
                d.id,
                COALESCE(dsm.name, dm.model_name) as name,
                d.serial_number,
                d.status,
                d.condition,
                d.condition_score,
                'Drone' as type,
                d.purchase_price::float,
                    d.est_sell_price::float,
                    d.notes,
                d.created_at,
                to_char(d.purchase_date, 'YYYY-MM-DD') as purchase_date,
                d.sub_model_id,

                -- COALESCE tetap sama, tapi isinya sekarang berupa array object
                COALESCE(img.image_urls, '[]') as image_urls

            FROM drones d
                     JOIN drone_models dm ON d.model_id = dm.id
                     LEFT JOIN drone_sub_models dsm ON d.sub_model_id = dsm.id

-- --- PERUBAHAN 1: Images untuk Drone ---
                     LEFT JOIN LATERAL (
                SELECT json_agg(
                               json_build_object(
                                       'id', id,               -- Tambahkan ID gambar
                                       'url', image_url        -- Label key 'url'
                                   )
                           ) as image_urls
                FROM item_images
                WHERE item_id = d.id AND item_type = 'Drone'
                    ) img ON true


            UNION ALL

            SELECT
                ai.id,
                acc.name,
                ai.serial_number,
                ai.status,
                ai.condition,
                ai.condition_score,
                'Accessory' as type,
                ai.purchase_price::float,
                    ai.est_sell_price::float,
                    ai.notes,
                ai.created_at,
                to_char(ai.purchase_date, 'YYYY-MM-DD'),
                NULL::int as sub_model_id,

                COALESCE(img.image_urls, '[]')

            FROM accessory_items ai
                     JOIN accessories acc ON ai.accessory_id = acc.id

-- --- PERUBAHAN 2: Images untuk Accessory ---
                     LEFT JOIN LATERAL (
                SELECT json_agg(
                               json_build_object(
                                       'id', id,               -- Tambahkan ID gambar
                                       'url', image_url        -- Label key 'url'
                                   )
                           ) as image_urls
                FROM item_images
                WHERE item_id = ai.id AND item_type = 'Accessory'
                    ) img ON true

            WHERE ai.drone_id IS NULL

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
            type, model_id, sub_model_id, name, serial_number, condition, condition_score,
            status, purchase_price, est_sell_price, notes,
            marketplace_links, bundle_items, purchase_date
        } = req.body;

        let itemId; // ID dari item utama (Drone / Aksesoris Utama)
        let createdBundleObjects = []; // Array untuk menampung ID & Harga bundle yang baru diinsert
        let totalPurchaseAmount = parseFloat(purchase_price); // Inisialisasi Total dengan Harga Utama
        const trxDate = purchase_date ? purchase_date : new Date();

        // A. INSERT KE TABEL UTAMA (DRONES / ACCESSORY_ITEMS)
        if (type === 'Drone') {
            const droneRes = await client.query(`
        INSERT INTO drones (model_id, sub_model_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes, purchase_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
      `, [model_id, sub_model_id || null, serial_number, purchase_price, est_sell_price, status, condition, condition_score || null, notes, trxDate]);
            itemId = droneRes.rows[0].id;

            // B. INSERT BUNDLE ITEMS (Jika Ada)
            if (bundle_items) {
                const bundles = JSON.parse(bundle_items); // Parse JSON String
                for (const b of bundles) {
                    // Pastikan 'buy' (modal) ada nilainya
                    const bundleBuyPrice = parseFloat(b.purchase_price || 0);

                    const bundleRes = await client.query(`INSERT INTO accessory_items 
                    (drone_id, accessory_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes, purchase_date)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id
                  `, [
                        itemId,           // drone_id (Parent)
                        b.acc_model_id,   // accessory_id (dari object acc_model)
                        b.serial_number,
                        bundleBuyPrice,
                        b.est_sell_price,
                        b.status || status,
                        b.condition || condition,
                        b.score || null,
                        b.note,
                        trxDate
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
        (accessory_id, drone_id, serial_number, purchase_price, est_sell_price, status, condition, condition_score, notes, purchase_date)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
                model_id,                 // $1: ID dari katalog accessories (dikirim sbg model_id dari FE)
                serial_number,            // $2
                purchase_price,              // $3
                est_sell_price,           // $4
                status,                   // $5
                condition,                // $6
                condition_score || null,  // $7: Jika 'Baru', score biasanya null/undefined
                notes,                    // $8
                trxDate
            ]);

            itemId = accRes.rows[0].id;
        }

        // C. INSERT MARKETPLACE LINKS
        if (marketplace_links) {
            const links = JSON.parse(marketplace_links);
            for (const link of links) {
                await client.query(`
            INSERT INTO marketplace_links 
            (item_type, item_id, platform, url, platform_price, admin_fee_pct, flat_fee)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
                    type, // 'Drone' atau 'Accessory' (Disesuaikan dengan variabel Anda)
                    itemId, // ID barang yang baru saja dibuat
                    link.platform,
                    link.url,
                    link.platform_price || null, // Null jika harga tidak diisi
                    link.admin_fee_pct || 0,
                    link.flat_fee || 0
                ]);
            }
        }

        // D. HANDLE IMAGE UPLOAD (Files dari Multer)
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                // upload ke ImgBB
                const imageUrl = await uploadToImgBB(file.path);

                await client.query(`
          INSERT INTO item_images (item_type, item_id, image_url)
          VALUES ($1, $2, $3)
        `, [type, itemId, imageUrl]);
            }
        }

        // --- C. LOGIC BARU: INSERT PURCHASE TRANSACTION ---

        // 1. Insert Header Transaksi
        const trxHeaderRes = await client.query(`
      INSERT INTO transactions (type, date, total_amount, notes)
      VALUES ('PURCHASE', $1, $2, $3)
      RETURNING id
    `, [
            trxDate,
            totalPurchaseAmount,
            `Pembelian Stok Baru: ${name} (${serial_number})`
        ]);

        const transactionId = trxHeaderRes.rows[0].id;

        // 2. Insert Transaction Item (Untuk ITEM UTAMA / Body)
        await client.query(`
      INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
      VALUES ($1, $2, $3, $4, 1)
    `, [transactionId, type, itemId, parseFloat(purchase_price)]);

        // 3. Insert Transaction Items (Untuk BUNDLE ITEMS - Jika Drone)
        if (createdBundleObjects.length > 0) {
            for (const bundleObj of createdBundleObjects) {
                await client.query(`
          INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
          VALUES ($1, 'Accessory', $2, $3, 1)
        `, [transactionId, bundleObj.id, bundleObj.price]);
            }
        }

        // --- DI DALAM createStock ---

// Parsing data String JSON dari req.body
        let mpLinks = [];
        if (req.body.marketplace_links) {
            try {
                mpLinks = JSON.parse(marketplace_links);
            } catch (e) {
                console.error("Gagal parsing marketplace_links:", e);
            }
        }

// Looping dan Insert ke tabel marketplace_links
        if (mpLinks.length > 0) {
            for (const link of mpLinks) {
                await client.query(`
            INSERT INTO marketplace_links 
            (item_type, item_id, platform, url, platform_price, admin_fee_pct, flat_fee)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
                    type, // 'Drone' atau 'Accessory' (Disesuaikan dengan variabel Anda)
                    itemId, // ID barang yang baru saja dibuat
                    link.platform,
                    link.url,
                    link.platform_price || null, // Null jika harga tidak diisi
                    link.admin_fee_pct || 0,
                    link.flat_fee || 0
                ]);
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
    // Multer SUDAH bekerja di sini
    console.log("--------------------------------------------------");
    console.log("DEBUG: ISI REQ.BODY (Text Fields):");
    console.log(req.body);

    console.log("DEBUG: ISI REQ.FILES (Gambar):");
    console.log(req.files);
    console.log("--------------------------------------------------");
    const { id } = req.params;
    const {
        type,
        model_id,
        sub_model_id,
        serial_number,
        status,
        condition,
        condition_score,
        notes,
        est_sell_price,
        purchase_price,
        purchase_date,
        bundle_items, // Array of objects dari frontend
        marketplace_links
    } = req.body;

    const trxDate = purchase_date ? purchase_date : new Date();
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // 1. UPDATE DATA UTAMA (BODY)
        if (type === 'Drone') {
            await client.query(`
        UPDATE drones
        SET model_id = $1, sub_model_id = $2, serial_number = $3, status = $4, condition = $5, condition_score = $6, notes = $7, est_sell_price = $8, purchase_price = $9, purchase_date = $10
        WHERE id = $11
      `, [model_id, sub_model_id || null, serial_number, status, condition, condition_score, notes, est_sell_price, purchase_price, trxDate, id]);

            // --- LOGIC BUNDLE ITEMS (HANYA UNTUK DRONE) ---
            const bundles = JSON.parse(bundle_items); // Parse JSON String
            if (bundles && Array.isArray(bundles)) {

                // A. Ambil ID Aksesoris yang saat ini terpasang di Drone ini dari DB
                const currentBundlesRes = await client.query(`SELECT id FROM accessory_items WHERE drone_id = $1`, [id]);
                const currentBundleIds = currentBundlesRes.rows.map(r => r.id);

                // B. Ambil ID Aksesoris yang dikirim dari Frontend (UI)
                const incomingBundleIds = bundles.filter(b => b.id != null).map(b => parseInt(b.id));

                // C. Cari Item yang di-HAPUS dari UI (Ada di DB, tapi tidak ada di kiriman UI)
                // Item ini kita DETACH (lepas jadi stok eceran)
                const detachedIds = currentBundleIds.filter(dbId => !incomingBundleIds.includes(dbId));

                if (detachedIds.length > 0) {
                    // Jadikan drone_id = NULL agar masuk ke etalase aksesoris mandiri
                    await client.query(`
            DELETE FROM accessory_items WHERE id = ANY($1::int[])
          `, [detachedIds]);
                }

                console.log('1aaaaaaaaaaaaaaa')
                // D. Loop kiriman dari UI untuk UPDATE data aksesoris yang tersisa
                for (const item of bundles) {
                    if (item.id) {
                        console.log('aaaaaaaaaaaaaaa')
                        // Update estimasi jual, status, dll (TIDAK update purchase_price)
                        await client.query(`
              UPDATE accessory_items 
              SET serial_number = $1, status = $2, condition = $3, condition_score = $4, notes = $5, est_sell_price = $6, drone_id = $7, purchase_date = $8
              WHERE id = $9
            `, [
                            item.serial_number,
                            item.status || status,
                            item.condition || condition,
                            item.condition_score,
                            item.notes,
                            item.est_sell_price, // Update harga pasarannya
                            item.is_detached ? null : id,
                            trxDate,
                            item.id,
                        ]);
                    } else {
                        console.log('abcdefghid')
                        await client.query(`
              INSERT INTO accessory_items (serial_number, status, condition , condition_score, notes, est_sell_price, purchase_price, drone_id, accessory_id, purchase_date)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                            item.serial_number,
                            item.status || status,
                            item.condition || condition,
                            item.score,
                            item.notes,
                            item.est_sell_price, // Update harga pasarannya
                            item.purchase_price,
                            id,
                            item.acc_model_id,
                            trxDate,
                        ])
                            .then(res => {
                                console.log(res.rows); // Log the results here
                            })
                            .catch(e => console.error(e.stack));
                    }
                }
            }

        } else if (type === 'Accessory') {
            // Aksesoris eceran tidak punya bundle
            await client.query(`
        UPDATE accessory_items 
        SET accessory_id = $1, serial_number = $2, status = $3, condition = $4, condition_score = $5, notes = $6, est_sell_price = $7
        WHERE id = $8
      `, [model_id, serial_number, status, condition, condition_score, notes, est_sell_price, id]);
        }

        await client.query('COMMIT');
        // D. HANDLE IMAGE UPDATE
// Asumsi: Saat user menghapus gambar lama di UI, Flutter akan mengirimkan
// array berisi ID gambar tersebut melalui req.body.deleted_image_ids
        if (req.body.deleted_image_ids) {
            let deletedIds = [];
            try {
                // Karena request ini berupa multipart/form-data,
                // array biasanya diterima sebagai string JSON "[12, 15]"
                deletedIds = JSON.parse(req.body.deleted_image_ids);
            } catch (e) {
                // Fallback jika sudah berupa array
                deletedIds = req.body.deleted_image_ids;
            }

            if (Array.isArray(deletedIds) && deletedIds.length > 0) {
                // 1. Hapus relasi gambar dari database
                // PENTING: Gunakan validasi item_id agar user tidak bisa sembarangan menghapus gambar barang lain
                await client.query(`
            DELETE FROM item_images 
            WHERE id = ANY($1::int[]) AND item_type = $2 AND item_id = $3
        `, [deletedIds, type, id]);

                // Catatan Bisnis: ImgBB API standar biasanya tidak menyediakan endpoint
                // untuk mendelete gambar via API Key. Jadi menghapusnya dari database
                // Anda sudah cukup agar gambar tersebut tidak muncul lagi di aplikasi.
            }
        }

// 2. Upload gambar BARU (Files dari Multer)
// req.files HANYA berisi foto baru yang di-pick dari galeri/kamera di halaman edit
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                // Upload ke ImgBB
                const imageUrl = await uploadToImgBB(file.path);

                // Insert ke database sebagai gambar tambahan
                await client.query(`
            INSERT INTO item_images (item_type, item_id, image_url)
            VALUES ($1, $2, $3)
        `, [type, id, imageUrl]);
            }
        }

        // Parsing data String JSON dari req.body
        let mpLinks = [];
        if (marketplace_links) {
            try {
                mpLinks = JSON.parse(marketplace_links);
            } catch (e) {
                console.error("Gagal parsing marketplace_links:", e);
            }
        }

        // 1. HAPUS SEMUA LINK LAMA (Berdasarkan item_id dan item_type)
// Ini menjamin link yang dihapus oleh user di aplikasi Flutter benar-benar lenyap dari DB
        await client.query(`
    DELETE FROM marketplace_links 
    WHERE item_type = $1 AND item_id = $2
`, [type, id]); // Sesuaikan nama variabel tipe dan ID Anda

// 2. INSERT ULANG SEMUA LINK DARI REQUEST FLUTTER
// Array dari Flutter sudah merepresentasikan state/kondisi terbaru yang diinginkan user
        if (mpLinks.length > 0) {
            for (const link of mpLinks) {
                await client.query(`
            INSERT INTO marketplace_links 
            (item_type, item_id, platform, url, platform_price, admin_fee_pct, flat_fee)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
                    type,
                    id,
                    link.platform,
                    link.url,
                    link.platform_price || null,
                    link.admin_fee_pct || 0,
                    link.flat_fee || 0
                ]);
            }
        }
        res.status(200).json({ message: 'Data stok dan bundle berhasil diperbarui' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Update Stock Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// src/controllers/inventoryController.js

const addStockAdjustment = async (req, res) => {
    // itemType: 'drones' atau 'accessory_items'
    // itemId: ID dari item tersebut
    const { itemType, itemId } = req.params;

    // type: 'REPAIR' atau 'REFUND'
    // amount: Nominal uang
    // notes: Catatan
    const { type, amount, notes } = req.body;

    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validasi Input
        if (!['REPAIR', 'REFUND'].includes(type)) {
            throw new Error("Invalid transaction type. Use REPAIR or REFUND.");
        }
        const cleanAmount = parseFloat(amount);

        // 2. Insert Header Transaksi (Keuangan)
        const trxRes = await client.query(`
      INSERT INTO transactions (type, date, total_amount, notes)
      VALUES ($1, NOW(), $2, $3)
      RETURNING id
    `, [type, cleanAmount, notes]);

        const trxId = trxRes.rows[0].id;

        // 3. Insert Transaction Item (Link History ke Barang)
        // Map table name ke 'Item Type' string untuk tabel transaction_items
        const itemTypeString = itemType === 'drones' ? 'Drone' : 'Accessory';

        await client.query(`
      INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
      VALUES ($1, $2, $3, $4, 1)
    `, [trxId, itemTypeString, itemId, cleanAmount]);

        // 4. UPDATE HARGA MODAL (Re-Evaluasi Aset)
        // REPAIR = Nambah Modal (+), REFUND = Kurang Modal (-)
        const operator = type === 'REPAIR' ? '+' : '-';

        // Pastikan nama tabel valid untuk mencegah SQL Injection
        const validTables = ['drones', 'accessory_items'];
        if (!validTables.includes(itemType)) {
            throw new Error("Invalid table name");
        }

        await client.query(`
      UPDATE ${itemType}
      SET purchase_price = purchase_price ${operator} $1
      WHERE id = $2
    `, [cleanAmount, itemId]);

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Adjustment berhasil disimpan',
            new_transaction_id: trxId
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Adjustment Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

const getStockDetail = async (req, res) => {
    const { itemType, id } = req.params;
    const client = await db.pool.connect();

    try {
        const trxItemType = itemType === 'drones' ? 'Drone' : 'Accessory';

        let queryText = '';

        if (itemType === 'drones') {
            queryText = `
        SELECT 
          d.*,
          COALESCE(dsm.name, m.model_name) as name,

          -- REPAIR & REFUND
          COALESCE((
            SELECT SUM(price) FROM transaction_items ti 
            JOIN transactions t ON ti.transaction_id = t.id 
            WHERE ti.item_type = 'Drone' AND ti.item_id = d.id AND t.type = 'REPAIR'
          ), 0) as total_repairs,

          COALESCE((
            SELECT SUM(price) FROM transaction_items ti 
            JOIN transactions t ON ti.transaction_id = t.id 
            WHERE ti.item_type = 'Drone' AND ti.item_id = d.id AND t.type = 'REFUND'
          ), 0) as total_refunds,

          -- ✅ IMAGES
          COALESCE(img.image_urls, '[]') as image_urls,

          -- ✅ MARKETPLACE
          COALESCE(mp.marketplace_links, '[]') as marketplace_links

        FROM drones d
        LEFT JOIN drone_models m ON d.model_id = m.id
        LEFT JOIN drone_sub_models dsm ON d.sub_model_id = dsm.id

        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', id,
              'url', image_url
            )
          ) as image_urls
          FROM item_images
          WHERE item_id = d.id AND item_type = 'Drone'
        ) img ON true

        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', id,
              'platform', platform,
              'url', url,
              'platform_price', platform_price::float,
              'admin_fee_pct', admin_fee_pct::float,
              'flat_fee', flat_fee::float
            )
          ) as marketplace_links
          FROM marketplace_links
          WHERE item_id = d.id AND item_type = 'Drone'
        ) mp ON true

        WHERE d.id = $1
      `;
        } else {
            queryText = `
        SELECT 
          a.*,
          am.name,

          COALESCE((
            SELECT SUM(price) FROM transaction_items ti 
            JOIN transactions t ON ti.transaction_id = t.id 
            WHERE ti.item_type = 'Accessory' AND ti.item_id = a.id AND t.type = 'REPAIR'
          ), 0) as total_repairs,

          COALESCE((
            SELECT SUM(price) FROM transaction_items ti 
            JOIN transactions t ON ti.transaction_id = t.id 
            WHERE ti.item_type = 'Accessory' AND ti.item_id = a.id AND t.type = 'REFUND'
          ), 0) as total_refunds,

          -- ✅ IMAGES
          COALESCE(img.image_urls, '[]') as image_urls,

          -- ✅ MARKETPLACE
          COALESCE(mp.marketplace_links, '[]') as marketplace_links

        FROM accessory_items a
        LEFT JOIN accessories am ON a.accessory_id = am.id

        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', id,
              'url', image_url
            )
          ) as image_urls
          FROM item_images
          WHERE item_id = a.id AND item_type = 'Accessory'
        ) img ON true

        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', id,
              'platform', platform,
              'url', url,
              'platform_price', platform_price::float,
              'admin_fee_pct', admin_fee_pct::float,
              'flat_fee', flat_fee::float
            )
          ) as marketplace_links
          FROM marketplace_links
          WHERE item_id = a.id AND item_type = 'Accessory'
        ) mp ON true

        WHERE a.id = $1
      `;
        }

        const itemRes = await client.query(queryText, [id]);

        if (itemRes.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const itemData = itemRes.rows[0];

        // Bundle (khusus drone)
        let bundleItems = [];
        if (itemType === 'drones') {
            const bundleRes = await client.query(`
        SELECT 
          ai.*,
          COALESCE(ai.notes, '') as notes,
          am.name
        FROM accessory_items ai
        LEFT JOIN accessories am ON ai.accessory_id = am.id
        WHERE ai.drone_id = $1
      `, [id]);

            bundleItems = bundleRes.rows;
        }

        const fullData = {
            ...itemData,
            bundle_items: bundleItems,
            marketplace_links: typeof itemData.marketplace_links === 'string'
                ? JSON.parse(itemData.marketplace_links)
                : itemData.marketplace_links,
            image_urls: typeof itemData.image_urls === 'string'
                ? JSON.parse(itemData.image_urls)
                : itemData.image_urls,
            type: trxItemType
        };

        res.json(fullData);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET Available (Detached) Accessories for Bundling
const getAvailableAccessories = async (req, res) => {
    const client = await db.pool.connect();

    try {
        // Syarat utama: drone_id IS NULL (Barang Eceran/Jomblo)
        // Syarat kedua: status = 'Ready' (Barang rusak/terjual tidak boleh di-attach)
        const queryText = `
      SELECT 
        a.*,
        am.name,
        
        -- Hitung history keuangan agar modal yang ditarik tetap akurat
        COALESCE((
          SELECT SUM(price) FROM transaction_items ti 
          JOIN transactions t ON ti.transaction_id = t.id 
          WHERE ti.item_type = 'Accessory' AND ti.item_id = a.id AND t.type = 'REPAIR'
        ), 0) as total_repairs,
        
        COALESCE((
          SELECT SUM(price) FROM transaction_items ti 
          JOIN transactions t ON ti.transaction_id = t.id 
          WHERE ti.item_type = 'Accessory' AND ti.item_id = a.id AND t.type = 'REFUND'
        ), 0) as total_refunds

      FROM accessory_items a
      JOIN accessories am ON a.accessory_id = am.id
      WHERE a.drone_id IS NULL 
        AND a.status = 'Ready'
      ORDER BY a.created_at DESC
    `;

        const { rows } = await client.query(queryText);

        // Parsing JSON fields jika tersimpan sebagai string (opsional, sesuaikan dengan struktur DB Anda)
        const formattedRows = rows.map(row => ({
            ...row,
            marketplace_links: typeof row.marketplace_links === 'string' ? JSON.parse(row.marketplace_links) : row.marketplace_links,
            image_urls: typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls
        }));

        res.status(200).json(formattedRows);

    } catch (err) {
        console.error("Get Available Accessories Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};


module.exports = { createStock, deleteStock, updateStock, getStockItems, addStockAdjustment, getStockDetail, getAvailableAccessories };
