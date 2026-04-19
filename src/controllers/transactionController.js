const db = require('../config/db');

// POST /transactions/sale
const createSale = async (req, res) => {
    const { date, total_price, notes, items, platform } = req.body;
    const client = await db.pool.connect();

    try {
        // 1. Mulai Transaksi Database
        await client.query('BEGIN');

        let totalCogs = 0;
        const processedItems = [];

        // 2. Looping setiap barang yang dibeli (Induk + Aksesoris)
        for (const item of items) {
            const { item_id, item_type, price } = item;
            let queryText = '';

            // A. Query untuk menarik Modal Asli (HPP) sekaligus mengecek status Ready
            // Kita tambahkan "FOR UPDATE" agar baris ini dikunci sementara (mencegah barang dibeli 2 kasir bersamaan)
            if (item_type === 'Drone') {
                queryText = `
          SELECT 

            purchase_price
          FROM drones 
          WHERE id = $1 AND status = 'Ready' 
          FOR UPDATE;
        `;
            } else if (item_type === 'Accessory') {
                queryText = `
          SELECT 
            purchase_price
          FROM accessory_items 
          WHERE id = $1 AND status = 'Ready' 
          FOR UPDATE;
        `;
            } else {
                throw new Error(`Tipe item tidak valid: ${item_type}`);
            }

            const itemRes = await client.query(queryText, [item_id]);

            // Validasi: Jika barang tidak ada atau sudah laku
            if (itemRes.rowCount === 0) {
                throw new Error(`${item_type} dengan ID ${item_id} tidak ditemukan atau statusnya sudah tidak Ready.`);
            }

            // B. Hitung Modal (HPP) Final untuk item ini
            const row = itemRes.rows[0];
            const baseModal = parseFloat(row.purchase_price) || 0;

            const finalCogs = baseModal;
            totalCogs += finalCogs; // Tambahkan ke keranjang HPP Induk

            // C. Simpan ke array sementara untuk di-insert ke transaction_items nanti
            processedItems.push({
                item_id,
                item_type,
                price: parseFloat(price) || 0, // Harga jual (0 untuk aksesoris, full untuk drone)
                cogs: finalCogs // Modal asli per item
            });

            // D. Update status barang di gudang menjadi 'Sold'
            const tableName = item_type === 'Drone' ? 'drones' : 'accessory_items';
            await client.query(`UPDATE ${tableName} SET status = 'Sold' WHERE id = $1`, [item_id]);
        }

        // 3. Buat Record Transaksi Induk (The Snapshot)
        const trxDate = date ? date : new Date();
        const insertTrxQuery = `
      INSERT INTO transactions (type, date, total_amount, total_cogs, notes, platform)
      VALUES ('SALE', $1, $2, $3, $4, $5)
      RETURNING id;
    `;
        const trxRes = await client.query(insertTrxQuery, [trxDate, total_price, totalCogs, notes, platform]);
        const transactionId = trxRes.rows[0].id;

        // 4. Masukkan Detail Transaksi (transaction_items)
        for (const pItem of processedItems) {
            await client.query(`
        INSERT INTO transaction_items (transaction_id, item_type, item_id, price, cogs)
        VALUES ($1, $2, $3, $4, $5)
      `, [transactionId, pItem.item_type, pItem.item_id, pItem.price, pItem.cogs]);
        }

        // 5. Commit Transaksi (Simpan Permanen)
        await client.query('COMMIT');

        res.status(201).json({
            message: "Penjualan berhasil dicatat",
            transaction_id: transactionId,
            total_amount: total_price,
            total_cogs: totalCogs,
            net_profit: parseFloat(total_price) - totalCogs
        });

    } catch (err) {
        // Jika ada 1 saja yang gagal (misal baterai ternyata sudah laku), batalkan SEMUA proses
        await client.query('ROLLBACK');
        console.error("Create Sale Error:", err);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};


// GET /api/v1/transactions
const getTransactions = async (req, res) => {
    try {
        const { type, status, platform, month, year, search, start_date, end_date } = req.query;

        let query = `
            SELECT 
                t.id,
                COALESCE(
                    (SELECT dm.model_name 
                     FROM transaction_items ti 
                     JOIN drones d ON ti.item_id = d.id 
                     JOIN drone_models dm ON d.model_id = dm.id 
                     WHERE ti.transaction_id = t.id AND ti.item_type = 'Drone' 
                     LIMIT 1),
                    (SELECT acc.name 
                     FROM transaction_items ti 
                     JOIN accessory_items ai ON ti.item_id = ai.id 
                     JOIN accessories acc ON ai.accessory_id = acc.id 
                     WHERE ti.transaction_id = t.id AND ti.item_type = 'Accessory' 
                     LIMIT 1)
                ) as title,
                t.date::text,
                t.total_amount::float as amount,
                (t.total_amount - t.total_cogs)::float as profit,
                t.notes,
                t.platform,
                t.type,
                'Success' as status -- Berdasarkan contoh respons, status tampaknya hardcoded Success atau bisa diambil dari data jika ada
            FROM transactions t
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (type) {
            query += ` AND t.type = $${paramCount++}`;
            params.push(type);
        }

        if (platform) {
            query += ` AND t.platform = $${paramCount++}`;
            params.push(platform);
        }

        if (month) {
            query += ` AND EXTRACT(MONTH FROM t.date) = $${paramCount++}`;
            params.push(month);
        }

        if (year) {
            query += ` AND EXTRACT(YEAR FROM t.date) = $${paramCount++}`;
            params.push(year);
        }

        if (start_date) {
            query += ` AND t.date >= $${paramCount++}`;
            params.push(start_date);
        }

        if (end_date) {
            query += ` AND t.date <= $${paramCount++}`;
            params.push(end_date);
        }

        if (search) {
            query += ` AND EXISTS (
                SELECT 1 FROM transaction_items ti 
                LEFT JOIN drones d ON ti.item_id = d.id AND ti.item_type = 'Drone'
                LEFT JOIN drone_models dm ON d.model_id = dm.id
                LEFT JOIN accessory_items ai ON ti.item_id = ai.id AND ti.item_type = 'Accessory'
                LEFT JOIN accessories acc ON ai.accessory_id = acc.id
                WHERE ti.transaction_id = t.id AND (
                    dm.model_name ILIKE $${paramCount} OR 
                    acc.name ILIKE $${paramCount} OR 
                    t.notes ILIKE $${paramCount}
                )
            )`;
            params.push(`%${search}%`);
            paramCount++;
        }

        query += ` ORDER BY t.date DESC`;

        const result = await db.query(query, params);

        // Calculate Summary
        const summaryQuery = `
            SELECT 
                SUM(t.amount)::float as total_amount,
                SUM(t.profit)::float as total_profit,
                COUNT(t.id)::int as total_count
            FROM (
                ${query.split('ORDER BY')[0]}
            ) t
        `;

        const summaryRes = await db.query(summaryQuery, params);
        const summary = summaryRes.rows[0] || { total_amount: 0, total_profit: 0, total_count: 0 };

        res.json({
            transactions: result.rows,
            summary: {
                total_amount: summary.total_amount || 0,
                total_profit: summary.total_profit || 0,
                total_count: summary.total_count || 0
            }
        });

    } catch (err) {
        console.error("Get Transactions Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/v1/transactions/:id
const getTransactionDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Get main transaction data
        const trxQuery = `
            SELECT 
                t.id, t.date::text as date, t.total_amount, t.total_cogs, 
                t.notes, t.platform, t.type
            FROM transactions t
            WHERE t.id = $1
        `;
        const trxRes = await db.query(trxQuery, [id]);

        if (trxRes.rowCount === 0) {
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }

        const transaction = trxRes.rows[0];

        // 2. Get transaction items data
        const itemsQuery = `
            SELECT 
                ti.id as transaction_item_id,
                ti.item_type,
                ti.item_id,
                ti.price,
                ti.cogs,
                CASE 
                    WHEN ti.item_type = 'Drone' THEN dm.model_name
                    WHEN ti.item_type = 'Accessory' THEN acc.name
                END as item_name,
                CASE 
                    WHEN ti.item_type = 'Drone' THEN d.serial_number
                    WHEN ti.item_type = 'Accessory' THEN ai.serial_number
                END as serial_number
            FROM transaction_items ti
            LEFT JOIN drones d ON ti.item_id = d.id AND ti.item_type = 'Drone'
            LEFT JOIN drone_models dm ON d.model_id = dm.id
            LEFT JOIN accessory_items ai ON ti.item_id = ai.id AND ti.item_type = 'Accessory'
            LEFT JOIN accessories acc ON ai.accessory_id = acc.id
            WHERE ti.transaction_id = $1
        `;
        
        const itemsRes = await db.query(itemsQuery, [id]);
        
        // Format the response
        transaction.items = itemsRes.rows;
        
        // Calculate total profit
        transaction.total_profit = parseFloat(transaction.total_amount) - parseFloat(transaction.total_cogs);

        res.json({
            message: "Berhasil mengambil detail transaksi",
            transaction
        });

    } catch (err) {
        console.error("Get Transaction Details Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/v1/transactions/:id
const deleteTransaction = async (req, res) => {
    const { id } = req.params;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get all transaction items
        const itemsRes = await client.query('SELECT item_id, item_type FROM transaction_items WHERE transaction_id = $1', [id]);
        
        // 2. Restore status of each item to 'Ready'
        for (const item of itemsRes.rows) {
            const tableName = item.item_type === 'Drone' ? 'drones' : 'accessory_items';
            await client.query(`UPDATE ${tableName} SET status = 'Ready' WHERE id = $1`, [item.item_id]);
        }

        // 3. Delete from transaction_items
        await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [id]);

        // 4. Delete the transaction itself
        const delRes = await client.query('DELETE FROM transactions WHERE id = $1 RETURNING id', [id]);
        
        if (delRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }

        await client.query('COMMIT');
        res.json({ message: "Transaksi berhasil dihapus dan status barang telah dikembalikan menjadi Ready" });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Delete Transaction Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

module.exports = { createSale, getTransactions, getTransactionDetails, deleteTransaction };
