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
            avgMarginResult,
            restockAlertsResult,
            slowMovingResult,
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

            // 5. Analytics: Top Selling Models
            db.query(`
        SELECT 
          dm.model_name,
          SUM(ti.quantity)::int as qty_sold,
          SUM(ti.price * ti.quantity)::numeric as revenue
        FROM transaction_items ti
        JOIN transactions t ON ti.transaction_id = t.id
        JOIN drones d ON ti.item_id = d.id
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE ti.item_type = 'Drone' 
          AND t.type = 'SALE'
          AND t.date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY dm.model_name
        ORDER BY qty_sold DESC
        LIMIT 5
      `),

            // 6. Analytics: Average Margin (6 months)
            db.query(`
        WITH monthly_data AS (
          SELECT 
            date_trunc('month', date) as month_date,
            SUM(total_amount)::numeric as revenue,
            SUM(total_amount - total_cogs)::numeric as profit
          FROM transactions
          WHERE type = 'SALE'
            AND date >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
          GROUP BY 1
        )
        SELECT 
          to_char(month_date, 'Mon') as period,
          month_date,
          profit as total_profit,
          CASE WHEN revenue > 0 THEN (profit / revenue * 100) ELSE 0 END::numeric as margin_percentage
        FROM monthly_data
        ORDER BY month_date ASC
      `),

            // 7. Analytics: Restock Alerts (Fast Moving)
            db.query(`
        WITH stock_data AS (
          SELECT 
            dm.id as model_id,
            dm.model_name,
            COUNT(d.id)::int as current_stock
          FROM drone_models dm
          LEFT JOIN drones d ON dm.id = d.model_id AND d.status = 'Ready'
          GROUP BY dm.id, dm.model_name
        ),
        sales_data AS (
          SELECT 
            dm.id as model_id,
            SUM(ti.quantity)::int as total_sold_60d
          FROM transaction_items ti
          JOIN transactions t ON ti.transaction_id = t.id
          JOIN drones d ON ti.item_id = d.id
          JOIN drone_models dm ON d.model_id = dm.id
          WHERE ti.item_type = 'Drone'
            AND t.type = 'SALE'
            AND t.date >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY dm.id
        )
        SELECT 
          sd.model_name,
          sd.current_stock,
          (COALESCE(sld.total_sold_60d, 0) / 2.0)::float as avg_monthly_sales
        FROM stock_data sd
        JOIN sales_data sld ON sd.model_id = sld.model_id
        WHERE sd.current_stock > 0 
          AND sd.current_stock < (COALESCE(sld.total_sold_60d, 0) / 2.0)
        ORDER BY (sd.current_stock / NULLIF(COALESCE(sld.total_sold_60d, 0) / 2.0, 0)) ASC
        LIMIT 5
      `),

            // 8. Analytics: Slow Moving Stock (Aging Inventory)
            db.query(`
        WITH stock_data AS (
          SELECT 
            dm.id as model_id,
            dm.model_name,
            COUNT(d.id)::int as current_stock
          FROM drone_models dm
          LEFT JOIN drones d ON dm.id = d.model_id AND d.status = 'Ready'
          GROUP BY dm.id, dm.model_name
        ),
        last_sale AS (
          SELECT 
            dm.id as model_id,
            MAX(t.date) as last_sale_date
          FROM transaction_items ti
          JOIN transactions t ON ti.transaction_id = t.id
          JOIN drones d ON ti.item_id = d.id
          JOIN drone_models dm ON d.model_id = dm.id
          WHERE ti.item_type = 'Drone' AND t.type = 'SALE'
          GROUP BY dm.id
        )
        SELECT 
          sd.model_name,
          sd.current_stock,
          EXTRACT(DAY FROM AGE(CURRENT_DATE, ls.last_sale_date))::int as days_since_last_sale
        FROM stock_data sd
        JOIN last_sale ls ON sd.model_id = ls.model_id
        WHERE sd.current_stock > 0 
          AND ls.last_sale_date < CURRENT_DATE - INTERVAL '30 days'
        ORDER BY days_since_last_sale DESC
        LIMIT 5
      `),

            // 9. Alert: Stok Ready Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'Ready'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 10. Alert: Stok Repair Terlama (1 Item)
            db.query(`
        SELECT d.id, dm.model_name, EXTRACT(DAY FROM AGE(CURRENT_DATE, d.updated_at)) as days
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'Repair'
        ORDER BY d.updated_at ASC
        LIMIT 1
      `),

            // 11. Market Insights (urutkan berdasarkan margin terbesar)
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

        // 1. Top Selling Model processing
        const topSellingData = topSellingResult.rows.map((row, index) => ({
            rank: index + 1,
            model_name: row.model_name,
            qty_sold: parseNum(row.qty_sold),
            revenue: parseNum(row.revenue)
        }));

        // 2. Average Margin processing
        const avgMarginRows = avgMarginResult.rows;
        let avgMarginTotal = 0;
        const avgMarginData = avgMarginRows.map(row => {
            const margin = parseNum(row.margin_percentage);
            avgMarginTotal += margin;
            return {
                period: row.period,
                margin_percentage: Number(margin.toFixed(1)),
                total_profit: parseNum(row.total_profit)
            };
        });
        const overallAvgMargin = avgMarginRows.length > 0 ? (avgMarginTotal / avgMarginRows.length).toFixed(1) : 0;
        
        let trendIndicator = { value: "0%", status: "neutral" };
        if (avgMarginRows.length >= 2) {
            const currentMonthMargin = parseNum(avgMarginRows[avgMarginRows.length - 1].margin_percentage);
            const prevMonthMargin = parseNum(avgMarginRows[avgMarginRows.length - 2].margin_percentage);
            const diff = currentMonthMargin - prevMonthMargin;
            trendIndicator = {
                value: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`,
                status: diff > 0 ? 'positive' : (diff < 0 ? 'negative' : 'neutral')
            };
        }

        // 3. Restock Alerts processing
        const restockData = restockAlertsResult.rows.map(row => {
            const current = parseNum(row.current_stock);
            const avg = parseNum(row.avg_monthly_sales);
            const ratio = avg > 0 ? Math.round((current / avg) * 100) : 0;
            return {
                model_name: row.model_name,
                current_stock: current,
                avg_monthly_sales: Number(avg.toFixed(1)),
                status_badge: "Kritis",
                stock_ratio_percentage: ratio
            };
        });

        // 4. Slow Moving processing
        const slowMovingData = slowMovingResult.rows.map(row => ({
            model_name: row.model_name,
            current_stock: parseNum(row.current_stock),
            days_since_last_sale: parseNum(row.days_since_last_sale),
            status_badge: "Warning"
        }));

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
                    card_id: "top_selling",
                    card_type: "list_ranking",
                    title: "Top Selling Model",
                    description: "Penjualan terbanyak 30 hari terakhir",
                    data: topSellingData
                },
                {
                    card_id: "average_margin",
                    card_type: "area_chart",
                    title: "Average Margin",
                    description: `Avg Profit: ${overallAvgMargin}%`,
                    trend_indicator: trendIndicator,
                    data: avgMarginData
                },
                {
                    card_id: "restock_alerts",
                    card_type: "list_progress",
                    title: "Restock Recommendations",
                    description: "Barang laku keras, stok menipis",
                    data: restockData
                },
                {
                    card_id: "slow_moving",
                    card_type: "list_aging",
                    title: "Slow Moving Stock",
                    description: "Perlu evaluasi harga atau promo",
                    data: slowMovingData
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
