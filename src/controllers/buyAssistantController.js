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
        const title = req.body.title || null;
        const description = req.body.description || null;
        const condition = req.body.condition || null;
        const condition_score = req.body.condition_score ? parseInt(req.body.condition_score) : null;
        const notes = req.body.notes || null;
        const author_id = req.body.author_id || null;

        // A. INSERT ke market_items (tabel induk)
        const marketItemRes = await client.query(
            'INSERT INTO market_items (item_type, source_platform, link, price, status, title, description, author_id) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
            [type, source_platform, link, price, status, title, description, author_id]
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

/**
 * Helper untuk format row Buy Assistant menjadi response object konsisten
 */
function formatBuyAssistantRow(row) {
    let imageUrls = [];
    if (row.images) {
        if (typeof row.images === 'string') {
            try {
                const parsed = JSON.parse(row.images);
                if (Array.isArray(parsed)) {
                    imageUrls = parsed;
                } else if (parsed) {
                    imageUrls = [parsed];
                }
            } catch (e) {
                imageUrls = [row.images];
            }
        } else if (Array.isArray(row.images)) {
            imageUrls = row.images;
        } else if (typeof row.images === 'object' && row.images !== null) {
            imageUrls = Object.values(row.images);
        }
    }

    imageUrls = imageUrls
        .map(item => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && item.url) return item.url;
            return item ? String(item) : null;
        })
        .filter(url => typeof url === 'string' && url.trim().length > 0);

    return {
        id: row.id,
        type: row.type,
        source_platform: row.source_platform || null,
        link: row.link || null,
        price: row.price || 0,
        status: row.status || null,
        title: row.title || null,
        description: row.description || null,
        drone_model_id: row.drone_model_id || null,
        model_name: row.model_name || null,
        sub_model_id: row.sub_model_id === null || row.sub_model_id === undefined ? null : Number(row.sub_model_id),
        sub_model_name: row.sub_model_name || null,
        drone_name: row.sub_model_name || row.model_name || row.title || null,
        completeness: row.completeness || null,
        location: row.location || null,
        seller_reputation: row.seller_reputation || null,
        accessory_id: row.accessory_id || null,
        accessory_name: row.accessory_name || row.title || null,
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
        created_at: row.created_at || null,
        author_id: row.author_id || null,
        author_name: row.author_name || null,
        author_url: row.author_url || null
    };
}

/**
 * Base query SQL untuk mengambil data Buy Assistant (Drone & Accessory)
 */
const BUY_ASSISTANT_BASE_QUERY = `
    SELECT
        mi.id,
        mi.item_type                          AS type,
        mi.source_platform                    AS source_platform,
        mi.link,
        mi.price::float,
        mi.status,
        mi.title,
        mi.description,
        mi.created_at,
        COALESCE(mi.author_id, fp.author_id)  AS author_id,
        fp.author_name                        AS author_name,
        fp.author_url                         AS author_url,

        md.drone_model_id                     AS drone_model_id,
        dm.model_name                         AS model_name,
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
    LEFT JOIN drone_models dm ON dm.id = md.drone_model_id
    LEFT JOIN drone_sub_models dsm ON dsm.id = md.sub_model_id
    LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
    LEFT JOIN facebook_posts fp ON fp.post_url = mi.link
    WHERE mi.item_type = 'Drone'
      AND NOT EXISTS (
          SELECT 1 FROM blocked_users bu
          WHERE bu.is_active = true
            AND bu.user_id = COALESCE(mi.author_id, fp.author_id)
            AND LOWER(bu.platform) = LOWER(CASE WHEN mi.source_platform ILIKE '%facebook%' THEN 'facebook' ELSE mi.source_platform END)
      )

    UNION ALL

    SELECT
        mi.id,
        mi.item_type                          AS type,
        mi.source_platform                    AS source_platform,
        mi.link,
        mi.price::float,
        mi.status,
        mi.title,
        mi.description,
        mi.created_at,
        COALESCE(mi.author_id, fp.author_id)  AS author_id,
        fp.author_name                        AS author_name,
        fp.author_url                         AS author_url,

        NULL::int                             AS drone_model_id,
        NULL::varchar                         AS model_name,
        NULL::int                             AS sub_model_id,
        NULL::varchar                         AS sub_model_name,
        NULL::varchar                         AS completeness,
        mac.location                          AS location,
        NULL::varchar                         AS seller_reputation,
        mac.condition,
        mac.condition_score                   AS condition_score,
        mac.notes,
        (SELECT json_agg(image_url) FROM item_images WHERE item_type = 'MarketAccessory' AND item_id = mi.id)::jsonb AS images,

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
    LEFT JOIN facebook_posts fp ON fp.post_url = mi.link
    WHERE mi.item_type = 'Accessory'
      AND NOT EXISTS (
          SELECT 1 FROM blocked_users bu
          WHERE bu.is_active = true
            AND bu.user_id = COALESCE(mi.author_id, fp.author_id)
            AND LOWER(bu.platform) = LOWER(CASE WHEN mi.source_platform ILIKE '%facebook%' THEN 'facebook' ELSE mi.source_platform END)
      )
`;

/**
 * GET /api/v1/buy-assistant/recommendations
 *
 * Query Params (opsional):
 *   status     - Active / Watchlist / Bought / Skipped / Sold
 *   type       - Drone / Accessory
 *   start_date - YYYY-MM-DD or ISO string
 *   end_date   - YYYY-MM-DD or ISO string
 */
const getRecommendations = async function (req, res) {
    try {
        const statusFilter = req.query.status || null;
        const typeFilter = req.query.type || null;
        const recommendationFilter = req.query.recommendation || req.query.buy_recommendation || null;
        const startDateFilter = req.query.start_date || null;
        const endDateFilter = req.query.end_date || null;

        // Filter dinamis (wrap UNION sebagai subquery)
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (statusFilter && statusFilter !== 'All' && statusFilter !== 'Semua') {
            const statuses = Array.isArray(statusFilter)
                ? statusFilter
                : String(statusFilter).split(',').map(s => s.trim()).filter(Boolean);

            if (statuses.length === 1) {
                conditions.push('status = $' + paramIndex);
                params.push(statuses[0]);
                paramIndex++;
            } else if (statuses.length > 1) {
                conditions.push('status = ANY($' + paramIndex + ')');
                params.push(statuses);
                paramIndex++;
            }
        }

        if (recommendationFilter && recommendationFilter !== 'All' && recommendationFilter !== 'Semua') {
            const recs = Array.isArray(recommendationFilter)
                ? recommendationFilter
                : String(recommendationFilter).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

            if (recs.length === 1) {
                conditions.push('UPPER(buy_recommendation) = $' + paramIndex);
                params.push(recs[0]);
                paramIndex++;
            } else if (recs.length > 1) {
                conditions.push('UPPER(buy_recommendation) = ANY($' + paramIndex + ')');
                params.push(recs);
                paramIndex++;
            }
        }

        if (typeFilter && typeFilter !== 'All' && typeFilter !== 'Semua') {
            conditions.push('type = $' + paramIndex);
            params.push(typeFilter);
            paramIndex++;
        }

        if (startDateFilter) {
            conditions.push('created_at >= $' + paramIndex);
            params.push(startDateFilter);
            paramIndex++;
        }

        if (endDateFilter) {
            conditions.push('created_at <= $' + paramIndex);
            params.push(endDateFilter);
            paramIndex++;
        }

        let fullQuery = 'SELECT * FROM (' + BUY_ASSISTANT_BASE_QUERY + ') AS combined';

        if (conditions.length > 0) {
            fullQuery += ' WHERE ' + conditions.join(' AND ');
        }

        fullQuery += ' ORDER BY created_at DESC';

        const result = await db.query(fullQuery, params);
        const rows = result.rows.map(formatBuyAssistantRow);

        res.status(200).json(rows);

    } catch (err) {
        console.error("Get Recommendations Error:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/v1/buy-assistant/:id
 * Get detail satu item Buy Assistant
 */
const getBuyAssistantDetail = async function (req, res) {
    try {
        const marketItemId = req.params.id;

        const query = 'SELECT * FROM (' + BUY_ASSISTANT_BASE_QUERY + ') AS combined WHERE id = $1';
        const result = await db.query(query, [marketItemId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Buy Assistant item not found' });
        }

        const formatted = formatBuyAssistantRow(result.rows[0]);
        res.status(200).json(formatted);

    } catch (err) {
        console.error("Get Buy Assistant Detail Error:", err);
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
        const title = req.body.title !== undefined ? req.body.title : null;
        const description = req.body.description !== undefined ? req.body.description : null;
        const author_id = req.body.author_id !== undefined ? req.body.author_id : null;

        const existingMarketItemRes = await client.query(
            `SELECT
                mi.item_type,
                mi.source_platform,
                mi.link,
                mi.price::float AS price,
                mi.status,
                mi.title,
                mi.description,
                md.drone_model_id,
                md.sub_model_id::int AS sub_model_id,
                md.condition AS drone_condition,
                md.condition_score AS drone_condition_score,
                mac.accessory_id,
                mac.condition AS acc_condition,
                mac.condition_score AS acc_condition_score,
                ma.fair_price::float AS fair_price,
                ma.buy_recommendation
             FROM market_items mi
             LEFT JOIN market_drones md ON md.id = mi.id
             LEFT JOIN market_accessories mac ON mac.id = mi.id
             LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
             WHERE mi.id = $1`,
            [marketItemId]
        );

        const oldSnap = existingMarketItemRes.rows[0] || {};

        await client.query(
            `UPDATE market_items
             SET item_type = $1,
                 source_platform = COALESCE($2, source_platform),
                 link = COALESCE($3, link),
                 price = COALESCE($4, price),
                 status = COALESCE($5, status),
                 title = COALESCE($6, title),
                 description = COALESCE($7, description),
                 author_id = COALESCE($8, author_id),
                 updated_at = NOW()
             WHERE id = $9`,
            [newType, source_platform, link, price, status, title, description, author_id, marketItemId]
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

        // D. AUTO-CAPTURE AI FEEDBACK LOOP (When user corrects classification or valuation from Frontend)
        const updatedSnapRes = await client.query(
            `SELECT
                mi.item_type,
                mi.title,
                mi.description,
                mi.price::float AS price,
                md.drone_model_id,
                md.sub_model_id::int AS sub_model_id,
                md.condition AS drone_condition,
                md.condition_score AS drone_condition_score,
                md.notes AS drone_notes,
                mac.accessory_id,
                mac.condition AS acc_condition,
                mac.condition_score AS acc_condition_score,
                mac.notes AS acc_notes,
                ma.fair_price::float AS fair_price,
                ma.buy_recommendation
             FROM market_items mi
             LEFT JOIN market_drones md ON md.id = mi.id
             LEFT JOIN market_accessories mac ON mac.id = mi.id
             LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
             WHERE mi.id = $1`,
            [marketItemId]
        );
        const newSnap = updatedSnapRes.rows[0] || {};

        const oldCond = oldSnap.item_type === 'Accessory' ? oldSnap.acc_condition : oldSnap.drone_condition;
        const oldCondScore = oldSnap.item_type === 'Accessory' ? oldSnap.acc_condition_score : oldSnap.drone_condition_score;
        const newCond = newSnap.item_type === 'Accessory' ? newSnap.acc_condition : newSnap.drone_condition;
        const newCondScore = newSnap.item_type === 'Accessory' ? newSnap.acc_condition_score : newSnap.drone_condition_score;

        const classificationChanged =
            oldSnap.item_type !== newSnap.item_type ||
            (oldSnap.drone_model_id || null) !== (newSnap.drone_model_id || null) ||
            (oldSnap.sub_model_id || null) !== (newSnap.sub_model_id || null) ||
            (oldSnap.accessory_id || null) !== (newSnap.accessory_id || null) ||
            (oldSnap.fair_price || null) !== (newSnap.fair_price || null) ||
            (oldSnap.buy_recommendation || null) !== (newSnap.buy_recommendation || null) ||
            Boolean(req.body.feedback_reason);

        let feedbackId = null;
        if (classificationChanged && req.body.skip_ai_feedback !== 'true') {
            const feedbackReason = req.body.feedback_reason || req.body.notes || null;
            const fbInsert = await client.query(
                `INSERT INTO ai_classification_feedback (
                    market_item_id, title, description_snippet, listing_price,
                    original_item_type, original_model_id, original_sub_model_id, original_accessory_id,
                    original_condition, original_condition_score, original_fair_price, original_recommendation,
                    corrected_item_type, corrected_model_id, corrected_sub_model_id, corrected_accessory_id,
                    corrected_condition, corrected_condition_score, corrected_fair_price, corrected_recommendation,
                    feedback_reason, is_active
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14, $15, $16,
                    $17, $18, $19, $20,
                    $21, true
                ) RETURNING id`,
                [
                    marketItemId,
                    newSnap.title || oldSnap.title || null,
                    (newSnap.description || oldSnap.description || '').substring(0, 500) || null,
                    newSnap.price || oldSnap.price || null,
                    oldSnap.item_type || null,
                    oldSnap.drone_model_id || null,
                    oldSnap.sub_model_id || null,
                    oldSnap.accessory_id || null,
                    oldCond || null,
                    oldCondScore || null,
                    oldSnap.fair_price || null,
                    oldSnap.buy_recommendation || null,
                    newSnap.item_type || null,
                    newSnap.drone_model_id || null,
                    newSnap.sub_model_id || null,
                    newSnap.accessory_id || null,
                    newCond || null,
                    newCondScore || null,
                    newSnap.fair_price || null,
                    newSnap.buy_recommendation || null,
                    feedbackReason
                ]
            );
            feedbackId = fbInsert.rows[0].id;

            // Optional: Also update master catalog default_sell_price if requested
            if (
                (req.body.update_master_price === true || req.body.update_master_price === 'true') &&
                newSnap.fair_price &&
                newSnap.fair_price > 0
            ) {
                if (newSnap.item_type === 'Drone' && newSnap.sub_model_id) {
                    await client.query(
                        `UPDATE drone_sub_models SET default_sell_price = $1 WHERE id = $2`,
                        [newSnap.fair_price, newSnap.sub_model_id]
                    );
                } else if (newSnap.item_type === 'Accessory' && newSnap.accessory_id) {
                    await client.query(
                        `UPDATE accessories SET default_est_sell_price = $1 WHERE id = $2`,
                        [newSnap.fair_price, newSnap.accessory_id]
                    );
                }
            }
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Data Buy Assistant berhasil diperbarui',
            market_item_id: marketItemId,
            type: newType,
            ai_feedback_recorded: Boolean(feedbackId),
            ai_feedback_id: feedbackId
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

/**
 * POST /api/v1/buy-assistant/block-user
 * Memblokir seller/user dan memindahkan listingnya ke 'Skipped'
 */
const blockUser = async function (req, res) {
    const {
        market_item_id,
        user_id,
        user_name,
        platform = 'facebook',
        profile_url,
        reason
    } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'user_id wajib diisi untuk memblokir user' });
    }

    const normalizedPlatform = (platform || 'facebook').toLowerCase();
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Upsert into blocked_users
        const blockResult = await client.query(
            `INSERT INTO blocked_users (user_id, user_name, platform, profile_url, reason, is_active, updated_at)
             VALUES ($1, $2, $3, $4, $5, true, NOW())
             ON CONFLICT (platform, user_id)
             DO UPDATE SET
                 user_name = COALESCE(EXCLUDED.user_name, blocked_users.user_name),
                 profile_url = COALESCE(EXCLUDED.profile_url, blocked_users.profile_url),
                 reason = COALESCE(EXCLUDED.reason, blocked_users.reason),
                 is_active = true,
                 updated_at = NOW()
             RETURNING *`,
            [
                String(user_id).trim(),
                user_name ? String(user_name).trim() : null,
                normalizedPlatform,
                profile_url ? String(profile_url).trim() : null,
                reason ? String(reason).trim() : null
            ]
        );

        const blockedUser = blockResult.rows[0];

        // 2. Jika market_item_id disertakan, pastikan author_id terisi jika sebelumnya null, dan set status ke 'Skipped'
        if (market_item_id) {
            await client.query(
                `UPDATE market_items
                 SET status = 'Skipped',
                     author_id = COALESCE(author_id, $1),
                     updated_at = NOW()
                 WHERE id = $2`,
                [String(user_id).trim(), market_item_id]
            );
        }

        // 3. Update semua listing lain dari author_id ini menjadi 'Skipped'
        await client.query(
            `UPDATE market_items
             SET status = 'Skipped',
                 updated_at = NOW()
             WHERE author_id = $1 AND status != 'Skipped'`,
            [String(user_id).trim()]
        );

        // 4. Update listing yang terhubung lewat facebook_posts jika ada
        await client.query(
            `UPDATE market_items mi
             SET status = 'Skipped',
                 author_id = COALESCE(mi.author_id, $1),
                 updated_at = NOW()
             FROM facebook_posts fp
             WHERE mi.link = fp.post_url
               AND fp.author_id = $1
               AND mi.status != 'Skipped'`,
            [String(user_id).trim()]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: `User ${blockedUser.user_name || blockedUser.user_id} berhasil diblokir`,
            data: blockedUser
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Block User Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/v1/buy-assistant/blocked-users
 * Mengambil daftar user yang sedang diblokir
 */
const getBlockedUsers = async function (req, res) {
    try {
        const result = await db.query(
            `SELECT id, user_id, user_name, platform, profile_url, reason, is_active, created_at, updated_at
             FROM blocked_users
             WHERE is_active = true
             ORDER BY updated_at DESC`
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Get Blocked Users Error:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/v1/buy-assistant/unblock-user/:id or DELETE /api/v1/buy-assistant/blocked-users/:id
 * Membuka blokir user
 */
const unblockUser = async function (req, res) {
    const id = req.params.id;
    try {
        const result = await db.query(
            `UPDATE blocked_users
             SET is_active = false, updated_at = NOW()
             WHERE id = $1 OR user_id = $1
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Data blocked user tidak ditemukan' });
        }

        res.status(200).json({
            message: 'User berhasil di-unblock',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Unblock User Error:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/v1/buy-assistant/:id/feedback
 * Menyimpan koreksi/feedback evaluasi AI dari Frontend sekaligus memperbarui item & opsional harga katalog master
 */
const submitAIFeedback = async function (req, res) {
    const marketItemId = parseInt(req.params.id);
    if (!marketItemId || isNaN(marketItemId)) {
        return res.status(400).json({ error: 'ID market item tidak valid' });
    }

    const {
        type,
        drone_model_id,
        sub_model_id,
        accessory_id,
        condition,
        condition_score,
        fair_price,
        buy_recommendation,
        status,
        feedback_reason,
        update_master_price = false,
        update_sub_model_rule = null
    } = req.body || {};

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Ambil state sebelum dikoreksi
        const oldRes = await client.query(
            `SELECT
                mi.id,
                mi.item_type,
                mi.title,
                mi.description,
                mi.price::float AS price,
                mi.status,
                md.drone_model_id,
                md.sub_model_id::int AS sub_model_id,
                md.condition AS drone_condition,
                md.condition_score AS drone_condition_score,
                mac.accessory_id,
                mac.condition AS acc_condition,
                mac.condition_score AS acc_condition_score,
                ma.fair_price::float AS fair_price,
                ma.buy_recommendation
             FROM market_items mi
             LEFT JOIN market_drones md ON md.id = mi.id
             LEFT JOIN market_accessories mac ON mac.id = mi.id
             LEFT JOIN market_analysis ma ON ma.market_item_id = mi.id
             WHERE mi.id = $1`,
            [marketItemId]
        );

        if (oldRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Market item tidak ditemukan' });
        }

        const oldSnap = oldRes.rows[0];
        const newType = type || oldSnap.item_type || 'Drone';
        const newModelId = drone_model_id !== undefined ? (drone_model_id ? parseInt(drone_model_id) : null) : oldSnap.drone_model_id;
        const newSubModelId = sub_model_id !== undefined ? (sub_model_id ? parseInt(sub_model_id) : null) : oldSnap.sub_model_id;
        const newAccId = accessory_id !== undefined ? (accessory_id ? parseInt(accessory_id) : null) : oldSnap.accessory_id;
        const oldCond = oldSnap.item_type === 'Accessory' ? oldSnap.acc_condition : oldSnap.drone_condition;
        const oldCondScore = oldSnap.item_type === 'Accessory' ? oldSnap.acc_condition_score : oldSnap.drone_condition_score;
        const newCond = condition !== undefined ? condition : oldCond;
        const newCondScore = condition_score !== undefined ? (condition_score ? parseInt(condition_score) : null) : oldCondScore;
        const newFairPrice = fair_price !== undefined && fair_price !== null && fair_price !== '' ? parseFloat(fair_price) : oldSnap.fair_price;
        const itemPrice = oldSnap.price || 0;
        const newProfit = newFairPrice && itemPrice > 0 ? Math.round(newFairPrice - itemPrice) : 0;
        const newRec = buy_recommendation || oldSnap.buy_recommendation || (newProfit >= 500000 ? 'BUY' : 'CONSIDER');
        const newStatus = status || (newRec === 'BUY' ? 'Watchlist' : (newRec === 'PASS' || newRec === 'SKIP' ? 'Skipped' : oldSnap.status));

        // 2. Update market_items
        await client.query(
            `UPDATE market_items SET item_type = $1, status = $2, updated_at = NOW() WHERE id = $3`,
            [newType, newStatus, marketItemId]
        );

        // 3. Update detail table
        if (newType === 'Drone') {
            await client.query(
                `UPDATE market_drones
                 SET drone_model_id = $1,
                     sub_model_id = $2,
                     condition = COALESCE($3, condition),
                     condition_score = COALESCE($4, condition_score),
                     notes = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE notes END
                 WHERE id = $6`,
                [newModelId, newSubModelId, newCond, newCondScore, feedback_reason || null, marketItemId]
            );
        } else if (newType === 'Accessory') {
            await client.query(
                `UPDATE market_accessories
                 SET accessory_id = $1,
                     condition = COALESCE($2, condition),
                     condition_score = COALESCE($3, condition_score),
                     notes = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE notes END
                 WHERE id = $5`,
                [newAccId, newCond, newCondScore, feedback_reason || null, marketItemId]
            );
        }

        // 4. Update market_analysis
        const existingAnalysis = await client.query(`SELECT id FROM market_analysis WHERE market_item_id = $1`, [marketItemId]);
        if (existingAnalysis.rows.length > 0) {
            await client.query(
                `UPDATE market_analysis
                 SET fair_price = COALESCE($1, fair_price),
                     condition_score = COALESCE($2, condition_score),
                     profit_prediction = $3,
                     buy_recommendation = $4
                 WHERE market_item_id = $5`,
                [newFairPrice, newCondScore, newProfit, newRec, marketItemId]
            );
        } else {
            await client.query(
                `INSERT INTO market_analysis (market_item_id, fair_price, price_score, condition_score, completeness_score, profit_prediction, buy_recommendation)
                 VALUES ($1, $2, 6, $3, 5, $4, $5)`,
                [marketItemId, newFairPrice || 0, newCondScore || 4, newProfit, newRec]
            );
        }

        // 5. Insert into ai_classification_feedback
        const fbRes = await client.query(
            `INSERT INTO ai_classification_feedback (
                market_item_id, title, description_snippet, listing_price,
                original_item_type, original_model_id, original_sub_model_id, original_accessory_id,
                original_condition, original_condition_score, original_fair_price, original_recommendation,
                corrected_item_type, corrected_model_id, corrected_sub_model_id, corrected_accessory_id,
                corrected_condition, corrected_condition_score, corrected_fair_price, corrected_recommendation,
                feedback_reason, is_active
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16,
                $17, $18, $19, $20,
                $21, true
            ) RETURNING *`,
            [
                marketItemId,
                oldSnap.title || null,
                (oldSnap.description || '').substring(0, 500) || null,
                oldSnap.price || null,
                oldSnap.item_type || null,
                oldSnap.drone_model_id || null,
                oldSnap.sub_model_id || null,
                oldSnap.accessory_id || null,
                oldCond || null,
                oldCondScore || null,
                oldSnap.fair_price || null,
                oldSnap.buy_recommendation || null,
                newType,
                newModelId,
                newSubModelId,
                newAccId,
                newCond,
                newCondScore,
                newFairPrice,
                newRec,
                feedback_reason || null
            ]
        );

        // 6. Optional: Update master catalog default_sell_price or sub-model rule description
        if ((update_master_price === true || update_master_price === 'true') && newFairPrice && newFairPrice > 0) {
            if (newType === 'Drone' && newSubModelId) {
                await client.query(
                    `UPDATE drone_sub_models SET default_sell_price = $1 WHERE id = $2`,
                    [newFairPrice, newSubModelId]
                );
            } else if (newType === 'Accessory' && newAccId) {
                await client.query(
                    `UPDATE accessories SET default_est_sell_price = $1 WHERE id = $2`,
                    [newFairPrice, newAccId]
                );
            }
        }

        if (update_sub_model_rule && newSubModelId) {
            await client.query(
                `UPDATE drone_sub_models
                 SET description = CASE
                     WHEN description IS NULL OR LENGTH(TRIM(description)) = 0 THEN $1
                     ELSE description || ' | ' || $1
                 END
                 WHERE id = $2`,
                [String(update_sub_model_rule).trim(), newSubModelId]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Koreksi & Feedback AI berhasil disimpan untuk pembelajaran evaluasi berikutnya',
            feedback: fbRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Submit AI Feedback Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/v1/buy-assistant/ai-feedbacks
 * Mengambil riwayat koreksi/feedback evaluasi AI
 */
const getAIFeedbacks = async function (req, res) {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await db.query(
            `SELECT
                f.*,
                dm_orig.model_name AS original_model_name,
                dsm_orig.name AS original_sub_model_name,
                dm_corr.model_name AS corrected_model_name,
                dsm_corr.name AS corrected_sub_model_name,
                acc_corr.name AS corrected_accessory_name
             FROM ai_classification_feedback f
             LEFT JOIN drone_models dm_orig ON dm_orig.id = f.original_model_id
             LEFT JOIN drone_sub_models dsm_orig ON dsm_orig.id = f.original_sub_model_id
             LEFT JOIN drone_models dm_corr ON dm_corr.id = f.corrected_model_id
             LEFT JOIN drone_sub_models dsm_corr ON dsm_corr.id = f.corrected_sub_model_id
             LEFT JOIN accessories acc_corr ON acc_corr.id = f.corrected_accessory_id
             WHERE f.is_active = true
             ORDER BY f.created_at DESC
             LIMIT $1`,
            [limit]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Get AI Feedbacks Error:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /api/v1/buy-assistant/ai-feedbacks/:feedbackId
 * Menonaktifkan rule/feedback koreksi AI
 */
const deleteAIFeedback = async function (req, res) {
    const feedbackId = parseInt(req.params.feedbackId);
    try {
        const result = await db.query(
            `UPDATE ai_classification_feedback
             SET is_active = false, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [feedbackId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Data feedback AI tidak ditemukan' });
        }
        res.status(200).json({
            message: 'Feedback AI berhasil dihapus/dinonaktifkan',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Delete AI Feedback Error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    createBuyAssistant: createBuyAssistant,
    getRecommendations: getRecommendations,
    getBuyAssistantDetail: getBuyAssistantDetail,
    updateBuyAssistant: updateBuyAssistant,
    deleteBuyAssistant: deleteBuyAssistant,
    blockUser: blockUser,
    getBlockedUsers: getBlockedUsers,
    unblockUser: unblockUser,
    submitAIFeedback: submitAIFeedback,
    getAIFeedbacks: getAIFeedbacks,
    deleteAIFeedback: deleteAIFeedback
};
