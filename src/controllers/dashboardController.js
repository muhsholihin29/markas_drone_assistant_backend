// src/controllers/dashboardController.js
const db = require('../config/db');

const getDashboardData = async (req, res) => {
    try {
        // Kita jalankan semua query secara paralel untuk efisiensi
        const [
            salesOverviewResult,
            stockReadyResult,
            stockRepairResult,
            accessoryResult,
            topSellingResult,
            alertsReadyResult,
            alertsRepairResult,
            marketInsightsResult
        ] = await Promise.all([
            // 1. Sales Overview (Bulan Ini)
            db.query(`
        SELECT 
          SUM(t.total_amount) as total_sales,
          SUM(t.total_amount) - SUM(t.total_cogs) as total_profit
        FROM transactions t
        WHERE t.type = 'SALE' 
        AND date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
      `),

            // 2. Stock Card: Ready Stock
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM drones WHERE status = 'Ready'
      `),

            // 3. Stock Card: Repair Stock
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM drones WHERE status = 'Repair'
      `),

            // 4. Stock Card: Accessory Value
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM accessory_items WHERE status = 'Ready'
      `),

            // 5. Analytics: Top Selling Models (Top 4)
            db.query(`
        SELECT dm.model_name, COUNT(ti.id) as units_sold
        FROM transaction_items ti
        JOIN drones d ON ti.item_id = d.id
        JOIN drone_models dm ON d.model_id = dm.id
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE ti.item_type = 'drone' AND t.type = 'SALE'
        GROUP BY dm.model_name
        ORDER BY units_sold DESC
        LIMIT 4
      `),

            // 6. Alert: Stok Ready Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'Ready'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 7. Alert: Stok Repair Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'Repair'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 8. Market Insights (urutkan berdasarkan margin terbesar)
            db.query(`
        SELECT
          mi.id,
          mi.item_type AS type,
          COALESCE(mi.source_platform, '') AS source_platform,
          COALESCE(mi.link, '') AS link,
          COALESCE(mi.price::float, 0) AS price,
          COALESCE(mi.status, '') AS status,
          mi.created_at,

          CASE
            WHEN mi.item_type = 'Drone' THEN COALESCE(dsm.name, '')
            WHEN mi.item_type = 'Accessory' THEN COALESCE(acc.name, '')
            ELSE ''
          END AS name,

          CASE
            WHEN mi.item_type = 'Drone' THEN COALESCE(md.condition, '')
            WHEN mi.item_type = 'Accessory' THEN COALESCE(mac.condition, '')
            ELSE ''
          END AS condition,

          COALESCE(
            CASE
              WHEN mi.item_type = 'Drone' THEN md.condition_score
              WHEN mi.item_type = 'Accessory' THEN mac.condition_score
            END,
            0
          ) AS condition_score,

          COALESCE(ma.fair_price::float, 0) AS fair_price,
          COALESCE(ma.price_score, 0) AS price_score,
          COALESCE(ma.condition_score, 0) AS analysis_condition_score,
          COALESCE(ma.completeness_score, 0) AS completeness_score,
          COALESCE(ma.profit_prediction::float, 0) AS profit_prediction,
          COALESCE(ma.buy_recommendation, '') AS buy_recommendation,

          COALESCE(
            ma.profit_prediction,
            (ma.fair_price - mi.price),
            0
          )::float AS margin

        FROM market_items mi
        LEFT JOIN market_drones md
          ON mi.item_type = 'Drone'
         AND md.id = mi.id
        LEFT JOIN drone_sub_models dsm
          ON md.sub_model_id = dsm.id

        LEFT JOIN market_accessories mac
          ON mi.item_type = 'Accessory'
         AND mac.id = mi.id
        LEFT JOIN accessories acc
          ON mac.accessory_id = acc.id

        LEFT JOIN market_analysis ma
          ON ma.market_item_id = mi.id

        WHERE mi.status IN ('Active', 'Watchlist')
        ORDER BY margin DESC, mi.created_at DESC
        LIMIT 3
      `)
        ]);

        // --- PROCESSING DATA ---

        const parseNum = (val) => Number(val) || 0;

        const salesData = salesOverviewResult.rows[0];

        const profitChange = 12.5;
        const isProfitUp = true;

        const topSellingDataPoints = topSellingResult.rows.map(r => parseNum(r.units_sold));
        const topSellingDescription = topSellingResult.rows.length > 0
            ? `${topSellingResult.rows[0].model_name} (${topSellingResult.rows[0].units_sold} Unit)`
            : 'Belum ada data';

        const alerts = [];
        if (alertsReadyResult.rows.length > 0) {
            alerts.push({
                item: alertsReadyResult.rows[0].model_name,
                days: parseNum(alertsReadyResult.rows[0].days),
                type: 'Ready'
            });
        }
        if (alertsRepairResult.rows.length > 0) {
            alerts.push({
                item: alertsRepairResult.rows[0].model_name,
                days: parseNum(alertsRepairResult.rows[0].days),
                type: 'Repair'
            });
        }

        const marketInsights = marketInsightsResult.rows.map(row => ({
            id: row.id,
            type: row.type,
            name: row.name || '',
            condition: row.condition || '',
            condition_score: parseNum(row.condition_score),
            price: parseNum(row.price),
            fair_price: parseNum(row.fair_price),
            margin: parseNum(row.margin),
            buy_recommendation: row.buy_recommendation || '',
            source_platform: row.source_platform || '',
            link: row.link || '',
            status: row.status || '',
            created_at: row.created_at || null
        }));

        const responseData = {
            sales_overview: {
                total_sales: parseNum(salesData.total_sales),
                total_profit: parseNum(salesData.total_profit),
                profit_change_percentage: profitChange,
                is_profit_up: isProfitUp
            },
            stock_cards: [
                {
                    title: "Ready Stock",
                    total_monetary_value: parseNum(stockReadyResult.rows[0].total_value),
                    total_count: parseNum(stockReadyResult.rows[0].total_count)
                },
                {
                    title: "Repair Stock",
                    total_monetary_value: parseNum(stockRepairResult.rows[0].total_value),
                    total_count: parseNum(stockRepairResult.rows[0].total_count)
                },
                {
                    title: "Accessory Value",
                    total_monetary_value: parseNum(accessoryResult.rows[0].total_value),
                    total_count: parseNum(accessoryResult.rows[0].total_count)
                }
            ],
            analytics_previews: [
                {
                    title: "Top Selling Model",
                    description: topSellingDescription,
                    data_points: topSellingDataPoints
                },
                {
                    title: "Average Margin",
                    description: "Avg Profit: 18.5%",
                    data_points: [0.15, 0.18, 0.20]
                },
                {
                    title: "Stock Health Index",
                    description: "3 Model Overstock",
                    data_points: [40.0, 30.0, 15.0]
                }
            ],
            alerts: alerts,
            market_insights: marketInsights
        };

        res.status(200).json(responseData);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = {
    getDashboardData
};
