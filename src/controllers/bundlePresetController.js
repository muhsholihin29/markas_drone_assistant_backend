const db = require('../config/db');

exports.getBundlePresets = async (req, res) => {
    try {
        const { itemType, id } = req.params;

        const query = `
            WITH target_bundles AS (
                SELECT id AS bundle_id, name AS bundle_name
                FROM bundle_presets
                WHERE base_item_type ILIKE $1 AND base_item_id = $2
            ),
            physical_items_data AS (
                SELECT 
                    bpi.bundle_id,
                    bpi.item_type,
                    bpi.item_id,
                    LOWER(bpi.item_type) AS item_type_lower,
                    CASE 
                        WHEN bpi.item_type ILIKE 'drone' THEN d.purchase_price
                        WHEN bpi.item_type ILIKE 'accessory' THEN ai.purchase_price
                        ELSE 0
                    END AS hpp,
                    CASE 
                        WHEN bpi.item_type ILIKE 'drone' THEN dm.model_name
                        WHEN bpi.item_type ILIKE 'accessory' THEN a.name
                        ELSE 'Unknown'
                    END AS model_name,
                    CASE 
                        WHEN bpi.item_type ILIKE 'drone' THEN d.serial_number
                        WHEN bpi.item_type ILIKE 'accessory' THEN ai.serial_number
                        ELSE ''
                    END AS serial_number,
                    CASE 
                        WHEN bpi.item_type ILIKE 'drone' THEN d.notes
                        WHEN bpi.item_type ILIKE 'accessory' THEN ai.notes
                        ELSE ''
                    END AS notes
                FROM bundle_preset_items bpi
                INNER JOIN target_bundles tb ON bpi.bundle_id = tb.bundle_id
                LEFT JOIN drones d ON bpi.item_type ILIKE 'drone' AND bpi.item_id = d.id
                LEFT JOIN drone_models dm ON d.model_id = dm.id
                LEFT JOIN accessory_items ai ON bpi.item_type ILIKE 'accessory' AND bpi.item_id = ai.id
                LEFT JOIN accessories a ON ai.accessory_id = a.id
            ),
            bundle_hpp AS (
                SELECT 
                    bundle_id,
                    SUM(COALESCE(hpp, 0)) AS total_hpp,
                    json_agg(
                        json_build_object(
                            'id', item_id,
                            'type', item_type_lower,
                            'serial_number', COALESCE(serial_number, ''),
                            'notes', COALESCE(notes, '')
                        )
                    ) AS physical_items_json
                FROM physical_items_data
                GROUP BY bundle_id
            ),
            grouped_models AS (
                SELECT 
                    bundle_id,
                    model_name,
                    COUNT(*) AS qty
                FROM physical_items_data
                GROUP BY bundle_id, model_name
            ),
            bundle_summary AS (
                SELECT 
                    bundle_id,
                    string_agg(qty || 'x ' || model_name, ', ') AS items_summary
                FROM grouped_models
                GROUP BY bundle_id
            ),
            bundle_marketplaces_with_profit AS (
                SELECT 
                    bml.bundle_id,
                    bml.id AS link_id,
                    bml.platform,
                    bml.label,
                    bml.url,
                    bml.platform_price::FLOAT AS platform_price,
                    bml.admin_fee_pct::FLOAT AS admin_pct,
                    bml.flat_fee::FLOAT AS flat_fee,
                    ROUND((bml.platform_price * (bml.admin_fee_pct / 100.0)) + bml.flat_fee, 2)::FLOAT AS total_deduction,
                    ROUND(bml.platform_price - ((bml.platform_price * (bml.admin_fee_pct / 100.0)) + bml.flat_fee), 2)::FLOAT AS net_revenue,
                    ROUND((bml.platform_price - ((bml.platform_price * (bml.admin_fee_pct / 100.0)) + bml.flat_fee)) - COALESCE(bh.total_hpp, 0), 2)::FLOAT AS net_profit
                FROM bundle_marketplace_links bml
                INNER JOIN target_bundles tb ON bml.bundle_id = tb.bundle_id
                LEFT JOIN bundle_hpp bh ON bml.bundle_id = bh.bundle_id
            ),
            bundle_marketplace_agg AS (
                SELECT 
                    bundle_id,
                    json_agg(
                        json_build_object(
                            'link_id', link_id,
                            'platform', platform,
                            'label', label,
                            'url', url,
                            'platform_price', platform_price,
                            'fees', json_build_object(
                                'admin_pct', admin_pct,
                                'flat_fee', flat_fee,
                                'total_deduction', total_deduction
                            ),
                            'net_revenue', net_revenue,
                            'net_profit', net_profit
                        )
                    ) AS marketplaces_json,
                    MAX(net_profit) AS highest_potential_profit,
                    (
                        SELECT platform 
                        FROM bundle_marketplaces_with_profit bmwp_inner 
                        WHERE bmwp_inner.bundle_id = bundle_marketplaces_with_profit.bundle_id 
                        ORDER BY net_profit DESC 
                        LIMIT 1
                    ) AS best_platform
                FROM bundle_marketplaces_with_profit
                GROUP BY bundle_id
            )
            SELECT 
                tb.bundle_id,
                tb.bundle_name,
                json_build_object(
                    'total_hpp', COALESCE(bh.total_hpp, 0)::FLOAT,
                    'highest_potential_profit', COALESCE(bma.highest_potential_profit, 0)::FLOAT,
                    'best_platform', bma.best_platform
                ) AS financial_summary,
                COALESCE(bs.items_summary, '') AS items_summary,
                COALESCE(bh.physical_items_json, '[]'::json) AS physical_items,
                COALESCE(bma.marketplaces_json, '[]'::json) AS marketplaces
            FROM target_bundles tb
            LEFT JOIN bundle_hpp bh ON tb.bundle_id = bh.bundle_id
            LEFT JOIN bundle_summary bs ON tb.bundle_id = bs.bundle_id
            LEFT JOIN bundle_marketplace_agg bma ON tb.bundle_id = bma.bundle_id;
        `;

        const { rows } = await db.query(query, [itemType, id]);

        res.status(200).json({
            status: 'success',
            data: rows
        });

    } catch (error) {
        console.error('Error fetching bundle presets:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.createBundlePreset = async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const { name, base_item_type, base_item_id, items, marketplaces } = req.body;
        
        const insertPresetQuery = `
            INSERT INTO bundle_presets (name, base_item_type, base_item_id)
            VALUES ($1, $2, $3) RETURNING id;
        `;
        const presetResult = await client.query(insertPresetQuery, [name, base_item_type, base_item_id]);
        const bundleId = presetResult.rows[0].id;
        
        if (items && items.length > 0) {
            const itemValues = [];
            const itemSqlArr = [];
            let itemParamOffset = 1;
            for (const item of items) {
                itemSqlArr.push(`($${itemParamOffset}, $${itemParamOffset+1}, $${itemParamOffset+2})`);
                itemValues.push(bundleId, item.item_type, item.item_id);
                itemParamOffset += 3;
            }
            const insertItemsQuery = `
                INSERT INTO bundle_preset_items (bundle_id, item_type, item_id)
                VALUES ${itemSqlArr.join(', ')}
            `;
            await client.query(insertItemsQuery, itemValues);
        }
        
        if (marketplaces && marketplaces.length > 0) {
            const mpValues = [];
            const mpSqlArr = [];
            let mpParamOffset = 1;
            for (const mp of marketplaces) {
                mpSqlArr.push(`($${mpParamOffset}, $${mpParamOffset+1}, $${mpParamOffset+2}, $${mpParamOffset+3}, $${mpParamOffset+4}, $${mpParamOffset+5}, $${mpParamOffset+6})`);
                mpValues.push(bundleId, mp.platform, "label" in mp ? mp.label : null, mp.url, mp.platform_price, mp.admin_fee_pct || 0, mp.flat_fee || 0);
                mpParamOffset += 7;
            }
            const insertMpQuery = `
                INSERT INTO bundle_marketplace_links (bundle_id, platform, label, url, platform_price, admin_fee_pct, flat_fee)
                VALUES ${mpSqlArr.join(', ')}
            `;
            await client.query(insertMpQuery, mpValues);
        }
        
        await client.query('COMMIT');
        res.status(201).json({
            status: 'success',
            data: { id: bundleId }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating bundle preset:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
    } finally {
        client.release();
    }
};

exports.getBundlePresetById = async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            WITH items_data AS (
                SELECT 
                    bpi.bundle_id,
                    json_agg(
                        json_build_object(
                            'id', bpi.id,
                            'item_type', LOWER(bpi.item_type),
                            'item_id', bpi.item_id,
                            'name', (
                                SELECT CASE 
                                    WHEN bpi.item_type ILIKE 'drone' THEN (SELECT dm.model_name FROM drones d JOIN drone_models dm ON d.model_id = dm.id WHERE d.id = bpi.item_id)
                                    WHEN bpi.item_type ILIKE 'accessory' THEN (SELECT a.name FROM accessory_items ai JOIN accessories a ON ai.accessory_id = a.id WHERE ai.id = bpi.item_id)
                                    ELSE 'Unknown'
                                END
                            ),
                            'serial_number', (
                                SELECT CASE 
                                    WHEN bpi.item_type ILIKE 'drone' THEN (SELECT serial_number FROM drones WHERE id = bpi.item_id)
                                    WHEN bpi.item_type ILIKE 'accessory' THEN (SELECT serial_number FROM accessory_items WHERE id = bpi.item_id)
                                    ELSE ''
                                END
                            ),
                            'purchase_price', (
                                SELECT CASE 
                                    WHEN bpi.item_type ILIKE 'drone' THEN (SELECT purchase_price FROM drones WHERE id = bpi.item_id)
                                    WHEN bpi.item_type ILIKE 'accessory' THEN (SELECT purchase_price FROM accessory_items WHERE id = bpi.item_id)
                                    ELSE 0
                                END
                            )
                        )
                    ) AS items_json
                FROM bundle_preset_items bpi
                WHERE bpi.bundle_id = $1
                GROUP BY bpi.bundle_id
            ),
            marketplaces_data AS (
                SELECT 
                    bundle_id,
                    json_agg(
                        json_build_object(
                            'id', id,
                            'platform', platform,
                            'label', label,
                            'url', url,
                            'platform_price', platform_price::FLOAT,
                            'admin_fee_pct', admin_fee_pct::FLOAT,
                            'flat_fee', flat_fee::FLOAT
                        )
                    ) AS marketplaces_json
                FROM bundle_marketplace_links
                WHERE bundle_id = $1
                GROUP BY bundle_id
            )
            SELECT 
                bp.id,
                bp.name,
                bp.base_item_type,
                bp.base_item_id,
                COALESCE(id_data.items_json, '[]'::json) AS items,
                COALESCE(md.marketplaces_json, '[]'::json) AS marketplaces
            FROM bundle_presets bp
            LEFT JOIN items_data id_data ON bp.id = id_data.bundle_id
            LEFT JOIN marketplaces_data md ON bp.id = md.bundle_id
            WHERE bp.id = $1;
        `;
        const { rows } = await db.query(query, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Bundle preset not found' });
        }

        const data = rows[0];
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error('Error fetching bundle preset:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
    }
};

exports.updateBundlePreset = async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { name, base_item_type, base_item_id, items, marketplaces } = req.body;
        
        const updatePresetQuery = `
            UPDATE bundle_presets 
            SET name = $1, base_item_type = $2, base_item_id = $3
            WHERE id = $4
        `;
        await client.query(updatePresetQuery, [name, base_item_type, base_item_id, id]);
        
        await client.query('DELETE FROM bundle_preset_items WHERE bundle_id = $1', [id]);
        await client.query('DELETE FROM bundle_marketplace_links WHERE bundle_id = $1', [id]);
        
        if (items && items.length > 0) {
            const itemValues = [];
            const itemSqlArr = [];
            let itemParamOffset = 1;
            for (const item of items) {
                itemSqlArr.push(`($${itemParamOffset}, $${itemParamOffset+1}, $${itemParamOffset+2})`);
                itemValues.push(id, item.item_type, item.item_id);
                itemParamOffset += 3;
            }
            const insertItemsQuery = `
                INSERT INTO bundle_preset_items (bundle_id, item_type, item_id)
                VALUES ${itemSqlArr.join(', ')}
            `;
            await client.query(insertItemsQuery, itemValues);
        }
        
        if (marketplaces && marketplaces.length > 0) {
            const mpValues = [];
            const mpSqlArr = [];
            let mpParamOffset = 1;
            for (const mp of marketplaces) {
                mpSqlArr.push(`($${mpParamOffset}, $${mpParamOffset+1}, $${mpParamOffset+2}, $${mpParamOffset+3}, $${mpParamOffset+4}, $${mpParamOffset+5}, $${mpParamOffset+6})`);
                mpValues.push(id, mp.platform, "label" in mp ? mp.label : null, mp.url, mp.platform_price, mp.admin_fee_pct || 0, mp.flat_fee || 0);
                mpParamOffset += 7;
            }
            const insertMpQuery = `
                INSERT INTO bundle_marketplace_links (bundle_id, platform, label, url, platform_price, admin_fee_pct, flat_fee)
                VALUES ${mpSqlArr.join(', ')}
            `;
            await client.query(insertMpQuery, mpValues);
        }
        
        await client.query('COMMIT');
        res.status(200).json({ status: 'success', message: 'Bundle updated successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating bundle preset:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
    } finally {
        client.release();
    }
};

exports.deleteBundlePreset = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM bundle_presets WHERE id = $1', [id]);
        res.status(200).json({ status: 'success', message: 'Bundle preset deleted successfully' });
    } catch (error) {
        console.error('Error deleting bundle preset:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error', error: error.message });
    }
};

