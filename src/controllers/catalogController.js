// src/controllers/catalogController.js
const db = require('../config/db');

// 1. Get All Models
const getDroneModels = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM drone_models ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

const parsePrice = (val) => (val === "" || val === null || val === undefined) ? null : val;
// 2. Create Drone Model
const createDroneModel = async (req, res) => {
    const { brand, model_name, category, est_buy_price, est_sell_price } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO drone_models (brand, model_name, category, default_est_buy_price, default_est_sell_price) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [brand, model_name, category, parsePrice(est_buy_price), parsePrice(est_sell_price)] // Gunakan parsePrice
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 3. Get All Drone Sub Models
const getDroneSubModels = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT dsm.*, dm.brand AS model_brand, dm.model_name AS parent_model_name
            FROM drone_sub_models dsm
            LEFT JOIN drone_models dm ON dm.id = dsm.model_id
            ORDER BY dsm.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 4. Create Drone Sub Model
const createDroneSubModel = async (req, res) => {
    const { model_id, name, description, default_buy_price, default_sell_price } = req.body;

    try {
        const result = await db.query(
            `INSERT INTO drone_sub_models
             (model_id, name, description, default_buy_price, default_sell_price)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                model_id,
                name,
                description || null,
                parsePrice(default_buy_price) || 0,
                parsePrice(default_sell_price) || 0
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 5. Get All Accessories
const getAccessories = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM accessories ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 6. Create Accessory (Complex: Handle Relasi Many-to-Many logic di sini atau simpan JSON)
const createAccessory = async (req, res) => {
    const { name, type, est_buy_price, est_sell_price, compatible_drone_ids } = req.body;

    // Catatan: Untuk simplifikasi MVP, kita simpan compatible_ids sebagai array JSON di tabel accessories
    // atau abaikan dulu relasi tabel junction. Di sini saya asumsikan kolom compatible_drone_model_ids tipe JSONB/JSON.

    try {
        const result = await db.query(
            `INSERT INTO accessories (name, type, default_est_buy_price, default_est_sell_price, compatible_drone_model_ids) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, type, parsePrice(est_buy_price), parsePrice(est_sell_price), JSON.stringify(compatible_drone_ids)]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 7. Update Drone Model
const updateDroneModel = async (req, res) => {
    const { id } = req.params;
    const { brand, model_name, category, default_est_buy_price, default_est_sell_price } = req.body;
    try {
        const result = await db.query(
            `UPDATE drone_models 
       SET brand=$1, model_name=$2, category=$3, default_est_buy_price=$4, default_est_sell_price=$5 
       WHERE id=$6 RETURNING *`,
            [brand, model_name, category, parsePrice(default_est_buy_price), parsePrice(default_est_sell_price), id]
        );
        if (result.rows.length === 0) return res.status(404).send('Model not found');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 8. Update Drone Sub Model
const updateDroneSubModel = async (req, res) => {
    const { id } = req.params;
    const { model_id, name, description, default_buy_price, default_sell_price } = req.body;

    try {
        const result = await db.query(
            `UPDATE drone_sub_models
             SET model_id=$1,
                 name=$2,
                 description=$3,
                 default_buy_price=$4,
                 default_sell_price=$5
             WHERE id=$6
             RETURNING *`,
            [
                model_id,
                name,
                description || null,
                parsePrice(default_buy_price) || 0,
                parsePrice(default_sell_price) || 0,
                id
            ]
        );

        if (result.rows.length === 0) return res.status(404).send('Sub model not found');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 9. Delete Drone Model
const deleteDroneModel = async (req, res) => {
    const { id } = req.params;
    try {
        // Note: Ini akan gagal jika ID ini sudah dipakai di tabel 'drones' (Foreign Key Constraint)
        // Untuk MVP kita biarkan, tapi idealnya cek dulu atau gunakan soft delete.
        await db.query('DELETE FROM drone_models WHERE id = $1', [id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).send(err.message); // Biasanya error foreign key violation
    }
};

// 10. Delete Drone Sub Model
const deleteDroneSubModel = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM drone_sub_models WHERE id = $1', [id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 11. Update Accessory
const updateAccessory = async (req, res) => {
    const { id } = req.params;
    const { name, type, default_est_buy_price, default_est_sell_price, compatible_drone_ids } = req.body;
    try {
        const result = await db.query(
            `UPDATE accessories 
       SET name=$1, type=$2, default_est_buy_price=$3, default_est_sell_price=$4, compatible_drone_model_ids=$5 
       WHERE id=$6 RETURNING *`,
            [name, type, parsePrice(default_est_buy_price), parsePrice(default_est_sell_price), JSON.stringify(compatible_drone_ids), id]
        );
        if (result.rows.length === 0) return res.status(404).send('Accessory not found');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// 12. Delete Accessory
const deleteAccessory = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM accessories WHERE id = $1', [id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).send(err.message);
    }
};


module.exports = {
    getDroneModels,
    createDroneModel,
    getDroneSubModels,
    createDroneSubModel,
    getAccessories,
    createAccessory,
    updateDroneModel,
    updateDroneSubModel,
    deleteDroneModel,
    deleteDroneSubModel,
    updateAccessory,
    deleteAccessory
};
