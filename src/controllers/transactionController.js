const db = require('../config/db');

// POST /transactions/sale
const createSale = async (req, res) => {
    const { date, total_price, notes, items, platform, status } = req.body;
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
        const trxStatus = status || 'SUCCESS';
        const insertTrxQuery = `
      INSERT INTO transactions (type, date, total_amount, total_cogs, notes, platform, status)
      VALUES ('SALE', $1, $2, $3, $4, $5, $6)
      RETURNING id;
    `;
        const trxRes = await client.query(insertTrxQuery, [trxDate, total_price, totalCogs, notes, platform, trxStatus]);
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
                t.status as status
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

        if (status) {
            query += ` AND t.status = $${paramCount++}`;
            params.push(status);
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
            WHERE t.status IN ('SUCCESS', 'PROCESS')
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

// PATCH /api/v1/transactions/:id/status
const updateTransactionStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const client = await db.pool.connect();

    const allowedStatuses = ['SUCCESS', 'PROCESS', 'RETURN'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Status tidak valid. Harus berupa SUCCESS, PROCESS, atau RETURN" });
    }

    try {
        await client.query('BEGIN');

        // 1. Cek transaksi saat ini
        const trxQuery = await client.query('SELECT status, type FROM transactions WHERE id = $1', [id]);
        if (trxQuery.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }

        const currentStatus = trxQuery.rows[0].status;
        const trxType = trxQuery.rows[0].type;

        if (currentStatus === status) {
            await client.query('ROLLBACK');
            return res.status(200).json({ message: "Status sudah sama, tidak ada perubahan" });
        }

        // 2. Ambil item-item dalam transaksi
        const itemsRes = await client.query('SELECT item_id, item_type FROM transaction_items WHERE transaction_id = $1', [id]);

        // 3. Update status item (Drones / Accessories) berdasarkan perubahan status
        let itemStatusToUpdate = null;

        if (status === 'RETURN' && currentStatus !== 'RETURN') {
            // Jika penjualan diretur, barang kembali 'Ready'. Jika pembelian diretur, barang jadi 'Returned'
            itemStatusToUpdate = trxType === 'SALE' ? 'Ready' : 'Returned';
        } else if ((status === 'SUCCESS' || status === 'PROCESS') && currentStatus === 'RETURN') {
            // Jika batal retur, kembalikan ke status asalnya (jika SALE jadi Sold, jika PURCHASE jadi Ready)
            itemStatusToUpdate = trxType === 'SALE' ? 'Sold' : 'Ready';
        }

        if (itemStatusToUpdate) {
            for (const item of itemsRes.rows) {
                const tableName = item.item_type === 'Drone' ? 'drones' : 'accessory_items';
                await client.query(`UPDATE ${tableName} SET status = $1 WHERE id = $2`, [itemStatusToUpdate, item.item_id]);
            }
        }

        // 4. Update status transaksi
        await client.query('UPDATE transactions SET status = $1 WHERE id = $2', [status, id]);

        await client.query('COMMIT');
        res.json({ message: `Status transaksi berhasil diubah menjadi ${status}` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Update Transaction Status Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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
                t.notes, t.platform, t.type, t.status
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

        // 1. Get transaction info
        const trxQuery = await client.query('SELECT type FROM transactions WHERE id = $1', [id]);
        if (trxQuery.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Transaksi tidak ditemukan" });
        }
        const trxType = trxQuery.rows[0].type;

        // 2. Get all transaction items
        const itemsRes = await client.query('SELECT item_id, item_type FROM transaction_items WHERE transaction_id = $1', [id]);

        // 3. Process items based on transaction type
        for (const item of itemsRes.rows) {
            const tableName = item.item_type === 'Drone' ? 'drones' : 'accessory_items';
            
            if (trxType === 'SALE') {
                // Return stock to 'Ready'
                await client.query(`UPDATE ${tableName} SET status = 'Ready' WHERE id = $1`, [item.item_id]);
            } else if (trxType === 'PURCHASE') {
                // Delete stock entirely
                await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [item.item_id]);
            }
        }

        // 4. Delete from transaction_items
        await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [id]);

        // 5. Delete the transaction itself
        await client.query('DELETE FROM transactions WHERE id = $1', [id]);

        await client.query('COMMIT');
        
        const message = trxType === 'SALE' 
            ? "Transaksi penjualan berhasil dihapus dan status barang telah dikembalikan menjadi Ready"
            : "Transaksi pembelian berhasil dihapus beserta data barang yang dibeli";
            
        res.json({ message });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Delete Transaction Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

module.exports = { createSale, getTransactions, getTransactionDetails, updateTransactionStatus, deleteTransaction };
