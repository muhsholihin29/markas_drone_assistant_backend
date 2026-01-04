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
          SUM(t.total_price) as total_sales,
          SUM(ti.price - COALESCE(d.purchase_price, ai.purchase_price, 0)) as total_profit
        FROM transactions t
        JOIN transaction_items ti ON t.id = ti.transaction_id
        LEFT JOIN drones d ON ti.item_id = d.id AND ti.item_type = 'drone'
        LEFT JOIN accessory_items ai ON ti.item_id = ai.id AND ti.item_type = 'accessory'
        WHERE t.type = 'sale' 
        AND date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
      `),

            // 2. Stock Card: Ready Stock
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM drones WHERE status = 'ready'
      `),

            // 3. Stock Card: Repair Stock
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM drones WHERE status = 'repair'
      `),

            // 4. Stock Card: Accessory Value
            db.query(`
        SELECT COUNT(id) as total_count, COALESCE(SUM(purchase_price), 0) as total_value
        FROM accessory_items WHERE status = 'ready'
      `),

            // 5. Analytics: Top Selling Models (Top 4)
            db.query(`
        SELECT dm.model_name, COUNT(ti.id) as units_sold
        FROM transaction_items ti
        JOIN drones d ON ti.item_id = d.id
        JOIN drone_models dm ON d.model_id = dm.id
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE ti.item_type = 'drone' AND t.type = 'sale'
        GROUP BY dm.model_name
        ORDER BY units_sold DESC
        LIMIT 4
      `),

            // 6. Alert: Stok Ready Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'ready'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 7. Alert: Stok Repair Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'repair'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 8. Market Insights (3 Best Price)
            db.query(`
        SELECT dm.model_name, mi.price
        FROM market_items mi
        JOIN drone_models dm ON mi.drone_model_id = dm.id
        WHERE mi.status IN ('active', 'watchlist')
        ORDER BY mi.price ASC 
        LIMIT 3
      `)
        ]);

        // --- PROCESSING DATA ---

        // Helper untuk konversi string angka dari Postgres (SUM/COUNT return string) ke Number/Float
        const parseNum = (val) => Number(val) || 0;

        const salesData = salesOverviewResult.rows[0];

        // Logika Profit Change (Dummy calculation karena butuh data bulan lalu yang kompleks)
        // Di real case, Anda perlu query terpisah untuk bulan lalu.
        const profitChange = 12.5;
        const isProfitUp = true;

        // Mapping Top Selling ke format array angka
        const topSellingDataPoints = topSellingResult.rows.map(r => parseNum(r.units_sold));
        const topSellingDescription = topSellingResult.rows.length > 0
            ? `${topSellingResult.rows[0].model_name} (${topSellingResult.rows[0].units_sold} Unit)`
            : 'Belum ada data';

        // Gabungkan Alerts
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

        // Mapping Market Insights
        const marketInsights = marketInsightsResult.rows.map(row => ({
            model: row.model_name,
            price: parseNum(row.price)
        }));


        // --- CONSTRUCT FINAL JSON ---
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
                    data_points: topSellingDataPoints // [12, 8, 5]
                },
                {
                    // Dummy logic untuk Margin & Health (Logic query-nya cukup kompleks, bisa ditambahkan nanti)
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
