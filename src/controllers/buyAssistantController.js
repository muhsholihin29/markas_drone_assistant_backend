const db = require('../config/db');
const uploadToImgBB = require('../libraries/imageUploader');

/**
 * POST /api/v1/buy-assistant
 * Multipart Request (form-data)
 *
 * Text Fields:
 *   type              - 'Drone' | 'Accessory'
 *   source_platform   - Tokopedia / Shopee / Facebook / dll
 *   link              - Link listing marketplace
 *   price             - Harga yang diminta seller
 *   status            - Active / Watchlist / Bought / Skipped / Sold (default: Active)
 *
 *   -- Khusus Drone --
 *   drone_model_id    - drone_models.id
 *   sub_model_id      - (opsional) drone_sub_models.id
 *   completeness      - Kelengkapan unit
 *   location          - Lokasi seller
 *   seller_reputation - Reputasi seller
 *
 *   -- Khusus Accessory --
 *   accessory_id      - accessories.id
 *
 *   -- Shared --
 *   condition         - New / Bekas
 *   condition_score   - Skor kondisi (1-5)
 *   notes             - Catatan tambahan
 *
 *   -- Analysis (opsional) --
 *   fair_price            - Harga wajar
 *   price_score           - Skor harga (1-5)
 *   analysis_condition_score - Skor kondisi untuk analisis
 *   completeness_score    - Skor kelengkapan (1-5)
 *   profit_prediction     - Prediksi keuntungan
 *   buy_recommendation    - BUY / SKIP / HOLD
 *
 * Files:
 *   images            - Gambar listing (multiple, khusus Drone disimpan JSONB)
 */
const createBuyAssistant = async function (req, res) {
    console.log("--------------------------------------------------");
    console.log("DEBUG: BUY ASSISTANT - REQ.BODY:");
    console.log(req.body);
    console.log("DEBUG: BUY ASSISTANT - REQ.FILES:");
    console.log(req.files);
    console.log("--------------------------------------------------");

    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        const type = req.body.type;
        const source_platform = req.body.source_platform || null;
        const link = req.body.link || null;
        const price = parseFloat(req.body.price) || 0;
        const status = req.body.status || 'Active';
        const condition = req.body.condition || null;
        const condition_score = req.body.condition_score ? parseInt(req.body.condition_score) : null;
        const notes = req.body.notes || null;

        // A. INSERT ke market_items (tabel induk)
        const marketItemRes = await client.query(
            'INSERT INTO market_items (item_type, source_platform, link, price, status) ' +
            'VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [type, source_platform, link, price, status]
        );

        const marketItemId = marketItemRes.rows[0].id;

        // B. INSERT ke tabel detail sesuai type
        if (type === 'Drone') {
            const drone_model_id = req.body.drone_model_id ? parseInt(req.body.drone_model_id) : null;
            const sub_model_id = req.body.sub_model_id ? parseInt(req.body.sub_model_id) : null;
            const completeness = req.body.completeness || null;
            const location = req.body.location || null;
            const seller_reputation = req.body.seller_reputation || null;

            // Upload gambar ke ImgBB dan kumpulkan URL sebagai JSONB array
            const imageUrls = [];
            if (req.files && req.files.length > 0) {
                for (var i = 0; i < req.files.length; i++) {
                    var imageUrl = await uploadToImgBB(req.files[i].path);
                    imageUrls.push(imageUrl);
                }
            }

            const imagesJson = imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;

            await client.query(
                'INSERT INTO market_drones (id, drone_model_id, sub_model_id, condition, condition_score, completeness, location, seller_reputation, images, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [
                    marketItemId,
                    drone_model_id,
                    sub_model_id,
                    condition,
                    condition_score,
                    completeness,
                    location,
                    seller_reputation,
                    imagesJson,
                    notes
                ]
            );
        } else if (type === 'Accessory') {
            const accessory_id = req.body.accessory_id ? parseInt(req.body.accessory_id) : null;

            await client.query(
                'INSERT INTO market_accessories ' +
                '(id, accessory_id, condition, condition_score, notes) ' +
                'VALUES ($1, $2, $3, $4, $5)',
                [
                    marketItemId,
                    accessory_id,
                    condition,
                    condition_score,
                    notes
                ]
            );

            if (req.files && req.files.length > 0) {
                for (let j = 0; j < req.files.length; j++) {
                    const accImageUrl = await uploadToImgBB(req.files[j].path);

                    await client.query(
                        'INSERT INTO item_images (item_type, item_id, image_url) VALUES ($1, $2, $3)',
                        ['MarketAccessory', marketItemId, accImageUrl]
                    );
                }
            }
        } else {
            throw new Error('Invalid type. Use "Drone" or "Accessory".');
        }

        // C. INSERT market_analysis (opsional — jika data analisis dikirim)
        const fair_price = req.body.fair_price;
        const price_score = req.body.price_score;
        const analysis_condition_score = req.body.analysis_condition_score;
        const completeness_score = req.body.completeness_score;
        const profit_prediction = req.body.profit_prediction;
        const buy_recommendation = req.body.buy_recommendation;

        const hasAnalysis = fair_price || price_score || completeness_score ||
            profit_prediction || buy_recommendation;

        let analysisId = null;

        if (hasAnalysis) {
            const analysisRes = await client.query(
                'INSERT INTO market_analysis ' +
                '(market_item_id, fair_price, price_score, condition_score, ' +
                ' completeness_score, profit_prediction, buy_recommendation) ' +
                'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [
                    marketItemId,
                    fair_price ? parseFloat(fair_price) : null,
                    price_score ? parseInt(price_score) : null,
                    analysis_condition_score ? parseInt(analysis_condition_score) : null,
                    completeness_score ? parseInt(completeness_score) : null,
                    profit_prediction ? parseFloat(profit_prediction) : null,
                    buy_recommendation || null
                ]
            );

            analysisId = analysisRes.rows[0].id;
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Data Buy Assistant berhasil disimpan',
            market_item_id: marketItemId,
            type: type,
            analysis_id: analysisId
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Buy Assistant Create Error:", err);
        res.status(500).json({error: err.message});
    } finally {
        client.release();
    }
};

// ... existing code ...

/**
 * GET /api/v1/buy-assistant/recommendations
 *
 * Query Params (opsional):
 *   status   - Pending / Bought / Skipped
 *   type     - Drone / Accessory
 */
const getRecommendations = async function (req, res) {
    try {
        const statusFilter = req.query.status || null;
        const typeFilter = req.query.type || null;

        const query = `
            SELECT
                mi.id,
                mi.item_type                          AS type,
                mi.source_platform                    AS source_platform,
                mi.link,
                mi.price::float,
                mi.status,
                mi.created_at,

                md.drone_model_id                     AS drone_model_id,
                md.sub_model_id::int                  AS sub_model_id,
                dsm.name                              AS sub_model_name,
                md.completeness,
                md.location,
                md.seller_reputation                  AS seller_reputation,
                md.condition,
                md.condition_score                    AS condition_score,
                md.notes,
                md.images,

                NULL::int                             AS accessory_id,
                NULL::varchar                         AS accessory_name,

                ma.fair_price::float                  AS fair_price,
                ma.price_score                        AS price_score,
                ma.condition_score                    AS analysis_condition_score,
                ma.completeness_score                 AS completeness_score,
                ma.profit_prediction::float           AS profit_prediction,
                ma.buy_recommendation                 AS buy_recommendation

            FROM market_items mi
            JOIN market_drones md ON md.id = mi.id
            LEFT JOIN drone_sub_models dsm ON dsm.id = md.sub_model_id
            LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
            WHERE mi.item_type = 'Drone'

            UNION ALL

            SELECT
                mi.id,
                mi.item_type                          AS type,
                mi.source_platform                    AS source_platform,
                mi.link,
                mi.price::float,
                mi.status,
                mi.created_at,

                NULL::int                             AS drone_model_id,
                NULL::int                             AS sub_model_id,
                NULL::varchar                         AS sub_model_name,
                NULL::varchar                         AS completeness,
                NULL::varchar                         AS location,
                NULL::varchar                         AS seller_reputation,
                mac.condition,
                mac.condition_score                   AS condition_score,
                mac.notes,
                NULL::jsonb                           AS images,

                mac.accessory_id                      AS accessory_id,
                a.name                                AS accessory_name,

                ma.fair_price::float                  AS fair_price,
                ma.price_score                        AS price_score,
                ma.condition_score                    AS analysis_condition_score,
                ma.completeness_score                 AS completeness_score,
                ma.profit_prediction::float           AS profit_prediction,
                ma.buy_recommendation                 AS buy_recommendation

            FROM market_items mi
            JOIN market_accessories mac ON mac.id = mi.id
            LEFT JOIN accessories a ON a.id = mac.accessory_id
            LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
            WHERE mi.item_type = 'Accessory'
        `;

        // Filter dinamis (wrap UNION sebagai subquery)
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (statusFilter) {
            conditions.push('status = $' + paramIndex);
            params.push(statusFilter);
            paramIndex++;
        }

        if (typeFilter) {
            conditions.push('type = $' + paramIndex);
            params.push(typeFilter);
            paramIndex++;
        }

        let fullQuery = 'SELECT * FROM (' + query + ') AS combined';

        if (conditions.length > 0) {
            fullQuery += ' WHERE ' + conditions.join(' AND ');
        }

        fullQuery += ' ORDER BY created_at DESC';

        const result = await db.query(fullQuery, params);

        // Format response sesuai model Flutter (flat, snake_case)
        const rows = result.rows.map(function (row) {
            // Parse images JSONB → array of string
            let imageUrls = [];
            if (row.images) {
                if (typeof row.images === 'string') {
                    try { imageUrls = JSON.parse(row.images); } catch (e) { imageUrls = []; }
                } else if (Array.isArray(row.images)) {
                    imageUrls = row.images;
                }
            }

            return {
                id: row.id,
                type: row.type,
                source_platform: row.source_platform || null,
                link: row.link || null,
                price: row.price || 0,
                status: row.status || null,
                drone_model_id: row.drone_model_id || null,
                sub_model_id: row.sub_model_id === null || row.sub_model_id === undefined ? null : Number(row.sub_model_id),
                drone_name: row.sub_model_name || null,
                completeness: row.completeness || null,
                location: row.location || null,
                seller_reputation: row.seller_reputation || null,
                accessory_id: row.accessory_id || null,
                accessory_name: row.accessory_name || null,
                condition: row.condition || null,
                condition_score: row.condition_score || null,
                notes: row.notes || null,
                fair_price: row.fair_price || null,
                price_score: row.price_score || null,
                analysis_condition_score: row.analysis_condition_score || null,
                completeness_score: row.completeness_score || null,
                profit_prediction: row.profit_prediction || null,
                buy_recommendation: row.buy_recommendation || null,
                image_urls: imageUrls,
                created_at: row.created_at || null
            };
        });

        res.status(200).json(rows);

    } catch (err) {
        console.error("Get Recommendations Error:", err);
        res.status(500).json({ error: err.message });
    }
};

const updateBuyAssistant = async function (req, res) {
    const marketItemId = req.params.id;

    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        const itemRes = await client.query(
            'SELECT id, item_type FROM market_items WHERE id = $1',
            [marketItemId]
        );

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Buy Assistant item not found' });
        }

        const currentType = itemRes.rows[0].item_type;
        const newType = req.body.type || currentType;

        const source_platform = req.body.source_platform || null;
        const link = req.body.link || null;
        const price = req.body.price !== undefined ? (parseFloat(req.body.price) || 0) : null;
        const status = req.body.status || null;

        const existingMarketItemRes = await client.query(
            'SELECT source_platform, link, price, status FROM market_items WHERE id = $1',
            [marketItemId]
        );

        const existingMarketItem = existingMarketItemRes.rows[0];

        await client.query(
            `UPDATE market_items
             SET item_type = $1,
                 source_platform = COALESCE($2, source_platform),
                 link = COALESCE($3, link),
                 price = COALESCE($4, price),
                 status = COALESCE($5, status),
                 updated_at = NOW()
             WHERE id = $6`,
            [newType, source_platform, link, price, status, marketItemId]
        );

        if (currentType === 'Drone' && newType === 'Drone') {
            const drone_model_id = req.body.drone_model_id !== undefined ? (req.body.drone_model_id ? parseInt(req.body.drone_model_id) : null) : undefined;
            const sub_model_id = req.body.sub_model_id !== undefined ? (req.body.sub_model_id ? parseInt(req.body.sub_model_id) : null) : undefined;
            const completeness = req.body.completeness !== undefined ? req.body.completeness : undefined;
            const location = req.body.location !== undefined ? req.body.location : undefined;
            const seller_reputation = req.body.seller_reputation !== undefined ? req.body.seller_reputation : undefined;
            const condition = req.body.condition !== undefined ? req.body.condition : undefined;
            const condition_score = req.body.condition_score !== undefined ? (req.body.condition_score ? parseInt(req.body.condition_score) : null) : undefined;
            const notes = req.body.notes !== undefined ? req.body.notes : undefined;

            const oldImagesRes = await client.query(
                'SELECT images FROM market_drones WHERE id = $1',
                [marketItemId]
            );

            let finalImages = null;
            if (req.files && req.files.length > 0) {
                const imageUrls = [];
                for (let i = 0; i < req.files.length; i++) {
                    const imageUrl = await uploadToImgBB(req.files[i].path);
                    imageUrls.push(imageUrl);
                }
                finalImages = JSON.stringify(imageUrls);
            } else if (oldImagesRes.rows.length > 0) {
                finalImages = oldImagesRes.rows[0].images;
            }

            const existingDroneRes = await client.query(
                'SELECT id FROM market_drones WHERE id = $1',
                [marketItemId]
            );

            if (existingDroneRes.rows.length > 0) {
                await client.query(
                    `UPDATE market_drones
                     SET drone_model_id = COALESCE($1, drone_model_id),
                         sub_model_id = COALESCE($2, sub_model_id),
                         completeness = COALESCE($3, completeness),
                         location = COALESCE($4, location),
                         seller_reputation = COALESCE($5, seller_reputation),
                         condition = COALESCE($6, condition),
                         condition_score = COALESCE($7, condition_score),
                         notes = COALESCE($8, notes),
                         images = COALESCE($9, images)
                     WHERE id = $10`,
                    [
                        drone_model_id,
                        sub_model_id,
                        completeness,
                        location,
                        seller_reputation,
                        condition,
                        condition_score,
                        notes,
                        finalImages,
                        marketItemId
                    ]
                );
            } else {
                await client.query(
                    `INSERT INTO market_drones
                     (id, drone_model_id, sub_model_id, completeness, location, seller_reputation, condition, condition_score, notes, images)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        marketItemId,
                        drone_model_id !== undefined ? drone_model_id : null,
                        sub_model_id !== undefined ? sub_model_id : null,
                        completeness !== undefined ? completeness : null,
                        location !== undefined ? location : null,
                        seller_reputation !== undefined ? seller_reputation : null,
                        condition !== undefined ? condition : null,
                        condition_score !== undefined ? condition_score : null,
                        notes !== undefined ? notes : null,
                        finalImages
                    ]
                );
            }

            await client.query('DELETE FROM market_accessories WHERE id = $1', [marketItemId]);

        } else if (currentType === 'Accessory' && newType === 'Accessory') {
            const accessory_id = req.body.accessory_id !== undefined ? (req.body.accessory_id ? parseInt(req.body.accessory_id) : null) : undefined;
            const condition = req.body.condition !== undefined ? req.body.condition : undefined;
            const condition_score = req.body.condition_score !== undefined ? (req.body.condition_score ? parseInt(req.body.condition_score) : null) : undefined;
            const notes = req.body.notes !== undefined ? req.body.notes : undefined;

            const existingAccessoryRes = await client.query(
                'SELECT id FROM market_accessories WHERE id = $1',
                [marketItemId]
            );

            if (existingAccessoryRes.rows.length > 0) {
                await client.query(
                    `UPDATE market_accessories
                     SET accessory_id = COALESCE($1, accessory_id),
                         condition = COALESCE($2, condition),
                         condition_score = COALESCE($3, condition_score),
                         notes = COALESCE($4, notes)
                     WHERE id = $5`,
                    [accessory_id, condition, condition_score, notes, marketItemId]
                );
            } else {
                await client.query(
                    `INSERT INTO market_accessories
                     (id, accessory_id, condition, condition_score, notes)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        marketItemId,
                        accessory_id !== undefined ? accessory_id : null,
                        condition !== undefined ? condition : null,
                        condition_score !== undefined ? condition_score : null,
                        notes !== undefined ? notes : null
                    ]
                );
            }

            await client.query('DELETE FROM market_drones WHERE id = $1', [marketItemId]);

            if (req.files && req.files.length > 0) {
                await client.query(
                    `DELETE FROM item_images
                     WHERE item_type = 'MarketAccessory' AND item_id = $1`,
                    [marketItemId]
                );

                for (let j = 0; j < req.files.length; j++) {
                    const accImageUrl = await uploadToImgBB(req.files[j].path);
                    await client.query(
                        'INSERT INTO item_images (item_type, item_id, image_url) VALUES ($1, $2, $3)',
                        ['MarketAccessory', marketItemId, accImageUrl]
                    );
                }
            }

        } else {
            await client.query('DELETE FROM market_drones WHERE id = $1', [marketItemId]);
            await client.query('DELETE FROM market_accessories WHERE id = $1', [marketItemId]);

            if (newType === 'Drone') {
                const drone_model_id = req.body.drone_model_id ? parseInt(req.body.drone_model_id) : null;
                const sub_model_id = req.body.sub_model_id ? parseInt(req.body.sub_model_id) : null;
                const completeness = req.body.completeness || null;
                const location = req.body.location || null;
                const seller_reputation = req.body.seller_reputation || null;
                const condition = req.body.condition || null;
                const condition_score = req.body.condition_score ? parseInt(req.body.condition_score) : null;
                const notes = req.body.notes || null;

                const imageUrls = [];
                if (req.files && req.files.length > 0) {
                    for (let i = 0; i < req.files.length; i++) {
                        const imageUrl = await uploadToImgBB(req.files[i].path);
                        imageUrls.push(imageUrl);
                    }
                }

                const imagesJson = imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;

                await client.query(
                    'INSERT INTO market_drones (id, drone_model_id, sub_model_id, condition, condition_score, completeness, location, seller_reputation, images, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                    [
                        marketItemId,
                        drone_model_id,
                        sub_model_id,
                        condition,
                        condition_score,
                        completeness,
                        location,
                        seller_reputation,
                        imagesJson,
                        notes
                    ]
                );
            } else if (newType === 'Accessory') {
                const accessory_id = req.body.accessory_id ? parseInt(req.body.accessory_id) : null;
                const condition = req.body.condition || null;
                const condition_score = req.body.condition_score ? parseInt(req.body.condition_score) : null;
                const notes = req.body.notes || null;

                await client.query(
                    'INSERT INTO market_accessories (id, accessory_id, condition, condition_score, notes) VALUES ($1, $2, $3, $4, $5)',
                    [marketItemId, accessory_id, condition, condition_score, notes]
                );

                if (req.files && req.files.length > 0) {
                    for (let j = 0; j < req.files.length; j++) {
                        const accImageUrl = await uploadToImgBB(req.files[j].path);
                        await client.query(
                            'INSERT INTO item_images (item_type, item_id, image_url) VALUES ($1, $2, $3)',
                            ['MarketAccessory', marketItemId, accImageUrl]
                        );
                    }
                }
            }
        }

        const fair_price = req.body.fair_price;
        const price_score = req.body.price_score;
        const analysis_condition_score = req.body.analysis_condition_score;
        const completeness_score = req.body.completeness_score;
        const profit_prediction = req.body.profit_prediction;
        const buy_recommendation = req.body.buy_recommendation;

        const hasAnalysis = fair_price || price_score || completeness_score || profit_prediction || buy_recommendation;

        const existingAnalysisRes = await client.query(
            'SELECT id FROM market_analysis WHERE market_item_id = $1',
            [marketItemId]
        );

        if (hasAnalysis) {
            if (existingAnalysisRes.rows.length > 0) {
                await client.query(
                    `UPDATE market_analysis
                     SET fair_price = COALESCE($1, fair_price),
                         price_score = COALESCE($2, price_score),
                         condition_score = COALESCE($3, condition_score),
                         completeness_score = COALESCE($4, completeness_score),
                         profit_prediction = COALESCE($5, profit_prediction),
                         buy_recommendation = COALESCE($6, buy_recommendation)
                     WHERE market_item_id = $7`,
                    [
                        fair_price ? parseFloat(fair_price) : null,
                        price_score ? parseInt(price_score) : null,
                        analysis_condition_score ? parseInt(analysis_condition_score) : null,
                        completeness_score ? parseInt(completeness_score) : null,
                        profit_prediction ? parseFloat(profit_prediction) : null,
                        buy_recommendation || null,
                        marketItemId
                    ]
                );
            } else {
                await client.query(
                    `INSERT INTO market_analysis
                     (market_item_id, fair_price, price_score, condition_score, completeness_score, profit_prediction, buy_recommendation)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        marketItemId,
                        fair_price ? parseFloat(fair_price) : null,
                        price_score ? parseInt(price_score) : null,
                        analysis_condition_score ? parseInt(analysis_condition_score) : null,
                        completeness_score ? parseInt(completeness_score) : null,
                        profit_prediction ? parseFloat(profit_prediction) : null,
                        buy_recommendation || null
                    ]
                );
            }
        } else if (existingAnalysisRes.rows.length > 0 && req.body.clear_analysis === 'true') {
            await client.query(
                'DELETE FROM market_analysis WHERE market_item_id = $1',
                [marketItemId]
            );
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Data Buy Assistant berhasil diperbarui',
            market_item_id: marketItemId,
            type: newType
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy Assistant Update Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

const deleteBuyAssistant = async function (req, res) {
    const marketItemId = req.params.id;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        const itemRes = await client.query(
            'SELECT id, item_type FROM market_items WHERE id = $1',
            [marketItemId]
        );

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Buy Assistant item not found' });
        }

        const itemType = itemRes.rows[0].item_type;

        await client.query(
            'DELETE FROM market_analysis WHERE market_item_id = $1',
            [marketItemId]
        );

        if (itemType === 'Drone') {
            await client.query(
                'DELETE FROM market_drones WHERE id = $1',
                [marketItemId]
            );
        } else if (itemType === 'Accessory') {
            await client.query(
                'DELETE FROM market_accessories WHERE id = $1',
                [marketItemId]
            );
            await client.query(
                `DELETE FROM item_images
                 WHERE item_type = 'MarketAccessory' AND item_id = $1`,
                [marketItemId]
            );
        } else {
            await client.query('DELETE FROM market_drones WHERE id = $1', [marketItemId]);
            await client.query('DELETE FROM market_accessories WHERE id = $1', [marketItemId]);
            await client.query(
                `DELETE FROM item_images
                 WHERE item_type = 'MarketAccessory' AND item_id = $1`,
                [marketItemId]
            );
        }

        await client.query(
            'DELETE FROM market_items WHERE id = $1',
            [marketItemId]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Data Buy Assistant berhasil dihapus',
            market_item_id: marketItemId
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Buy Assistant Delete Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

module.exports = {
    createBuyAssistant: createBuyAssistant,
    getRecommendations: getRecommendations,
    updateBuyAssistant: updateBuyAssistant,
    deleteBuyAssistant: deleteBuyAssistant
};
