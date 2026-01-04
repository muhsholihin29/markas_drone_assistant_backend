const db = require('../config/db');

const createSale = async (req, res) => {
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        const {
            date,          // YYYY-MM-DD
            total_price,   // Numeric
            notes,         // Text
            items          // Array of { item_id, item_type, price }
        } = req.body;

        // 1. Insert Header Transaksi
        const trxRes = await client.query(`
      INSERT INTO transactions (type, date, total_price, notes)
      VALUES ('SALE', $1, $2, $3) 
      RETURNING id
    `, [date, total_price, notes]);

        const transactionId = trxRes.rows[0].id;

        // 2. Loop Items
        for (const item of items) {
            // item: { item_id: 10, item_type: 'Drone', price: 12000000 }

            // A. Insert ke Transaction Items
            await client.query(`
        INSERT INTO transaction_items (transaction_id, item_type, item_id, price, quantity)
        VALUES ($1, $2, $3, $4, 1)
      `, [transactionId, item.item_type, item.item_id, item.price]);

            // B. Update Status Stok Menjadi 'Sold'
            // Tentukan nama tabel berdasarkan item_type
            const table = item.item_type === 'Drone' ? 'drones' : 'accessory_items';

            // Update status stok
            await client.query(`
        UPDATE ${table} SET status = 'Sold', updated_at = NOW() WHERE id = $1
      `, [item.item_id]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Penjualan berhasil', transaction_id: transactionId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

module.exports = { createSale };
