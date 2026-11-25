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
            businessWalletResult,
            marketInsightsResult
        ] = await Promise.all([
            // 1. Sales Overview (Bulan Ini + Real-time MoM Apple-to-Apple + Settled vs Pending Profit)
            db.query(`
        SELECT 
          COALESCE(SUM(t.total_amount) FILTER (
            WHERE date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
          ), 0) as total_sales,
          COALESCE(SUM(t.total_amount - t.total_cogs) FILTER (
            WHERE date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
          ), 0) as total_profit,
          COALESCE(SUM(t.total_amount - t.total_cogs) FILTER (
            WHERE date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
              AND t.status = 'SUCCESS'
          ), 0) as settled_profit,
          COALESCE(SUM(t.total_amount - t.total_cogs) FILTER (
            WHERE date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
              AND t.status = 'PROCESS'
          ), 0) as pending_profit,
          COALESCE(SUM(t.total_amount - t.total_cogs) FILTER (
            WHERE t.date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
              AND t.date < date_trunc('month', CURRENT_DATE)
              AND EXTRACT(DAY FROM t.date) <= EXTRACT(DAY FROM CURRENT_DATE)
          ), 0) as prev_month_same_period_profit,
          COALESCE(SUM(t.total_amount - t.total_cogs) FILTER (
            WHERE date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
          ), 0) as prev_month_full_profit
        FROM transactions t
        WHERE t.type = 'SALE' 
          AND t.status IN ('SUCCESS', 'PROCESS')
          AND t.date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
          AND t.date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      `),

            // 2. Stock Card: Ready Stock (+ 4-Tier Aging Health Breakdown: <=90d, 91-180d, 181-365d, >365d)
            db.query(`
        WITH ready_aged AS (
          SELECT
            id,
            COALESCE(purchase_price, 0)::numeric AS val,
            GREATEST(0, (CURRENT_DATE - COALESCE(purchase_date, created_at::date)))::int AS age_days
          FROM drones
          WHERE status = 'Ready'
        )
        SELECT
          COUNT(id)::int AS total_count,
          COALESCE(SUM(val), 0) AS total_value,
          COUNT(id) FILTER (WHERE age_days <= 90)::int AS fresh_count,
          COALESCE(SUM(val) FILTER (WHERE age_days <= 90), 0) AS fresh_value,
          COUNT(id) FILTER (WHERE age_days BETWEEN 91 AND 180)::int AS watch_count,
          COALESCE(SUM(val) FILTER (WHERE age_days BETWEEN 91 AND 180), 0) AS watch_value,
          COUNT(id) FILTER (WHERE age_days BETWEEN 181 AND 365)::int AS critical_count,
          COALESCE(SUM(val) FILTER (WHERE age_days BETWEEN 181 AND 365), 0) AS critical_value,
          COUNT(id) FILTER (WHERE age_days > 365)::int AS dead_count,
          COALESCE(SUM(val) FILTER (WHERE age_days > 365), 0) AS dead_value
        FROM ready_aged
      `),

            // 3. Stock Card: Repair Stock (+ Potential Revenue, Profit & 4-Tier Aging Breakdown)
            db.query(`
        WITH repair_aged AS (
          SELECT
            id,
            COALESCE(purchase_price, 0)::numeric AS val,
            COALESCE(est_sell_price, purchase_price, 0)::numeric AS sell_val,
            GREATEST(0, COALESCE(est_sell_price, purchase_price, 0) - COALESCE(purchase_price, 0))::numeric AS profit_val,
            GREATEST(0, (CURRENT_DATE - COALESCE(purchase_date, updated_at::date, created_at::date)))::int AS age_days
          FROM drones
          WHERE status = 'Repair'
        )
        SELECT 
          COUNT(id)::int AS total_count, 
          COALESCE(SUM(val), 0) AS total_value,
          COALESCE(SUM(sell_val), 0) AS potential_sell_value,
          COALESCE(SUM(profit_val), 0) AS potential_profit,
          COUNT(id) FILTER (WHERE age_days > 14)::int AS overdue_repair_count,
          COUNT(id) FILTER (WHERE age_days <= 90)::int AS fresh_count,
          COALESCE(SUM(val) FILTER (WHERE age_days <= 90), 0) AS fresh_value,
          COUNT(id) FILTER (WHERE age_days BETWEEN 91 AND 180)::int AS watch_count,
          COALESCE(SUM(val) FILTER (WHERE age_days BETWEEN 91 AND 180), 0) AS watch_value,
          COUNT(id) FILTER (WHERE age_days BETWEEN 181 AND 365)::int AS critical_count,
          COALESCE(SUM(val) FILTER (WHERE age_days BETWEEN 181 AND 365), 0) AS critical_value,
          COUNT(id) FILTER (WHERE age_days > 365)::int AS dead_count,
          COALESCE(SUM(val) FILTER (WHERE age_days > 365), 0) AS dead_value
        FROM repair_aged
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
          AND t.status IN ('SUCCESS', 'PROCESS')
          AND t.date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY dm.model_name
        ORDER BY qty_sold DESC
        LIMIT 5
      `),

            // 6. Analytics: Kecepatan Laku per Model (Average Days to Sell)
            db.query(`
        SELECT
          dm.model_name,
          COUNT(ti.id)::int as qty_sold,
          AVG(GREATEST(0, (t.date::date - COALESCE(d.purchase_date, d.created_at::date))))::numeric(10,1) as avg_days_to_sell
        FROM transaction_items ti
        JOIN transactions t ON ti.transaction_id = t.id
        JOIN drones d ON ti.item_id = d.id
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE ti.item_type = 'Drone'
          AND t.type = 'SALE'
          AND t.status IN ('SUCCESS', 'PROCESS')
          AND t.date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY dm.id, dm.model_name
        ORDER BY avg_days_to_sell ASC, qty_sold DESC
        LIMIT 5
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
            AND t.status IN ('SUCCESS', 'PROCESS')
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

            // 8. Analytics: Physical Unit Aging (> 90 days: Watch 91-180d, Critical 181-365d, Dead >365d)
            db.query(`
        SELECT 
          d.id::int AS sample_drone_id,
          dm.model_name,
          COALESCE(dsm.name, '') AS sub_model_name,
          GREATEST(0, (CURRENT_DATE - COALESCE(d.purchase_date, d.created_at::date)))::int AS aging_days,
          COALESCE(d.purchase_price, 0)::float AS purchase_price,
          COALESCE(d.est_sell_price, dsm.default_sell_price, dm.default_est_sell_price, d.purchase_price * 1.15)::float AS est_sell_price,
          COALESCE(d.notes, '') AS notes
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        LEFT JOIN drone_sub_models dsm ON d.sub_model_id = dsm.id
        WHERE d.status = 'Ready'
          AND (CURRENT_DATE - COALESCE(d.purchase_date, d.created_at::date)) > 90
        ORDER BY aging_days DESC, purchase_price DESC
        LIMIT 25
      `),

            // 9. Alert: Stok Ready Terlama (1 Item + Markdown Hint)
            db.query(`
        SELECT 
          d.id, 
          dm.model_name, 
          GREATEST(0, (CURRENT_DATE - COALESCE(d.purchase_date, d.created_at::date)))::int as days,
          COALESCE(d.purchase_price, 0)::float as purchase_price,
          COALESCE(d.est_sell_price, dm.default_est_sell_price, 0)::float as est_sell_price
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        WHERE d.status = 'Ready'
        ORDER BY COALESCE(d.purchase_date, d.created_at::date) ASC
        LIMIT 1
      `),

            // 10. Repair Bottleneck & Capital Frozen Queue (Prioritized by Cash-Unlock ROI & Model DIO Velocity)
            db.query(`
        WITH model_dio AS (
          SELECT
            d2.model_id,
            AVG(GREATEST(1, (t.date::date - COALESCE(d2.purchase_date, d2.created_at::date))))::float AS avg_dio_days,
            COUNT(ti.id)::int AS sold_count
          FROM transaction_items ti
          JOIN transactions t ON ti.transaction_id = t.id
          JOIN drones d2 ON ti.item_id = d2.id AND ti.item_type = 'Drone'
          WHERE t.type = 'SALE' AND t.status IN ('SUCCESS', 'PROCESS')
          GROUP BY d2.model_id
        )
        SELECT 
          d.id::int AS id,
          dm.model_name,
          COALESCE(dsm.name, '') AS sub_model_name,
          GREATEST(0, (CURRENT_DATE - COALESCE(d.purchase_date, d.updated_at::date)))::int AS days,
          COALESCE(d.purchase_price, 0)::float AS purchase_price,
          COALESCE(d.est_sell_price, dsm.default_sell_price, dm.default_est_sell_price, d.purchase_price)::float AS est_sell_price,
          md.avg_dio_days,
          COALESCE(md.sold_count, 0)::int AS model_sold_count,
          COALESCE(d.notes, '') AS notes
        FROM drones d
        JOIN drone_models dm ON d.model_id = dm.id
        LEFT JOIN drone_sub_models dsm ON d.sub_model_id = dsm.id
        LEFT JOIN model_dio md ON md.model_id = d.model_id
        WHERE d.status = 'Repair'
        ORDER BY
          (GREATEST(100000, COALESCE(d.est_sell_price, dsm.default_sell_price, dm.default_est_sell_price, d.purchase_price) - COALESCE(d.purchase_price, 0))
            / GREATEST(5.0, COALESCE(md.avg_dio_days, 21.0))) DESC,
          days DESC
        LIMIT 6
      `),

            // 11. Business Wallet (Liquid Cash Available vs Pending Escrow PROCESS)
            db.query(`
        SELECT
          COALESCE(SUM(CASE
            WHEN type IN ('SALE', 'CAPITAL_INJECTION', 'LOAN_TAKEN', 'REFUND') AND status = 'SUCCESS' THEN ABS(total_amount)
            WHEN type IN ('PURCHASE', 'LOAN_REPAYMENT', 'REPAIR', 'PRIVE') AND status IN ('SUCCESS', 'PROCESS') THEN -ABS(total_amount)
            ELSE 0
          END), 0)::numeric AS cash_available,
          COALESCE(SUM(CASE
            WHEN type IN ('SALE', 'REFUND') AND status = 'PROCESS' THEN ABS(total_amount)
            ELSE 0
          END), 0)::numeric AS pending_cash,
          COUNT(CASE
            WHEN type IN ('SALE', 'REFUND') AND status = 'PROCESS' THEN 1
          END)::int AS pending_count,
          COALESCE(SUM(CASE
            WHEN type = 'LOAN_TAKEN' AND status IN ('SUCCESS', 'PROCESS') THEN ABS(total_amount)
            WHEN type = 'LOAN_REPAYMENT' AND status IN ('SUCCESS', 'PROCESS') THEN -ABS(total_amount)
            ELSE 0
          END), 0)::numeric AS savings_debt
        FROM transactions
      `),

            // 12. Market Insights (urutkan berdasarkan margin terbesar)
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

        const formatIdrCompact = (val) => {
            if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1).replace('.', ',')} jt`;
            if (val >= 1000) return `Rp ${Math.round(val / 1000)} rb`;
            return `Rp ${Math.round(val)}`;
        };

        const salesData = salesOverviewResult.rows[0] || {};
        const totalSales = parseNum(salesData.total_sales);
        const totalProfit = parseNum(salesData.total_profit);
        const settledProfit = parseNum(salesData.settled_profit);
        const pendingProfit = parseNum(salesData.pending_profit);
        const prevSamePeriodProfit = parseNum(salesData.prev_month_same_period_profit);
        const prevFullProfit = parseNum(salesData.prev_month_full_profit);
        const baselinePrevProfit = prevSamePeriodProfit !== 0 ? prevSamePeriodProfit : prevFullProfit;

        let profitChange = 0;
        let isProfitUp = true;
        if (baselinePrevProfit > 0) {
            const rawPct = ((totalProfit - baselinePrevProfit) / baselinePrevProfit) * 100;
            isProfitUp = totalProfit >= baselinePrevProfit;
            profitChange = Math.abs(Number(rawPct.toFixed(1)));
        } else if (totalProfit > 0) {
            profitChange = 100;
            isProfitUp = true;
        } else if (totalProfit < 0) {
            profitChange = 100;
            isProfitUp = false;
        }

        const now = new Date();
        const dayOfMonth = Math.max(1, now.getDate());
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const projectedProfit = Math.round((totalProfit / dayOfMonth) * daysInMonth);

        // 1. Top Selling Model processing
        const topSellingData = topSellingResult.rows.map((row, index) => ({
            rank: index + 1,
            model_name: row.model_name,
            qty_sold: parseNum(row.qty_sold),
            revenue: parseNum(row.revenue)
        }));

        // 2. Kecepatan Laku per Model processing (replacing Margin Trend)
        const velocityRows = avgMarginResult.rows;
        const velocityData = velocityRows.map(row => {
            const avgDays = Number(parseNum(row.avg_days_to_sell).toFixed(1));
            let badge = 'Normal';
            if (avgDays <= 7) badge = 'Sangat Cepat';
            else if (avgDays <= 14) badge = 'Cepat';
            return {
                model_name: row.model_name,
                qty_sold: parseNum(row.qty_sold),
                avg_days_to_sell: avgDays,
                status_badge: badge
            };
        });
        const overallAvgDays = velocityRows.length > 0
            ? (velocityRows.reduce((acc, r) => acc + parseNum(r.avg_days_to_sell), 0) / velocityRows.length).toFixed(1)
            : '0.0';
        const velocityTrendIndicator = {
            value: `${overallAvgDays} hari`,
            status: Number(overallAvgDays) <= 14 ? 'positive' : 'neutral'
        };

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

        // 4. Physical Unit Aging (4-Tier: Watch 91-180d, Critical 181-365d, Dead >365d)
        const slowMovingData = slowMovingResult.rows.map(row => {
            const agingDays = parseNum(row.aging_days);
            const buyPrice = parseNum(row.purchase_price);
            const sellPrice = parseNum(row.est_sell_price);
            const estMargin = Math.max(0, sellPrice - buyPrice);

            let agingTier = 'WATCH';
            let statusBadge = '3-6 Bln';
            let recommendedDiscount = 0;
            let estProfitAfterDiscount = estMargin;
            let actionHint = '';

            if (agingDays > 365) {
                agingTier = 'DEAD';
                statusBadge = '>1 Thn (Mati)';
                const targetClearPrice = buyPrice > 0 ? Math.round((buyPrice * 0.9) / 50000) * 50000 : sellPrice;
                recommendedDiscount = Math.max(0, sellPrice - targetClearPrice);
                estProfitAfterDiscount = Math.max(0, targetClearPrice - buyPrice);
                actionHint = 'Stok mati >1 thn: likuidasi harga pasar atau pecah jual ketengan (body/baterai/remote)';
            } else if (agingDays > 180) {
                agingTier = 'CRITICAL';
                statusBadge = '6-12 Bln';
                recommendedDiscount = estMargin > 100000
                    ? Math.round((estMargin * 0.75) / 50000) * 50000
                    : 0;
                estProfitAfterDiscount = Math.max(0, estMargin - recommendedDiscount);
                actionHint = recommendedDiscount > 0
                    ? `Jual cepat dekat HPP: turun ${formatIdrCompact(recommendedDiscount)} agar modal aman`
                    : 'Jual cepat mendekati HPP (BEP) agar modal tidak makin terdepresiasi';
            } else {
                agingTier = 'WATCH';
                statusBadge = '3-6 Bln';
                recommendedDiscount = estMargin > 200000
                    ? Math.round((estMargin * 0.30) / 50000) * 50000
                    : 0;
                estProfitAfterDiscount = Math.max(0, estMargin - recommendedDiscount);
                actionHint = recommendedDiscount > 0
                    ? `Saran diskon tipis ${formatIdrCompact(recommendedDiscount)} (sisa cuan ${formatIdrCompact(estProfitAfterDiscount)})`
                    : 'Refresh iklan marketplace atau buat paket bundling aksesoris';
            }

            return {
                model_name: row.sub_model_name ? `${row.model_name} (${row.sub_model_name})` : row.model_name,
                current_stock: 1,
                days_since_last_sale: agingDays,
                aging_tier: agingTier,
                status_badge: statusBadge,
                sample_drone_id: row.sample_drone_id ? parseNum(row.sample_drone_id) : null,
                purchase_price: buyPrice,
                est_sell_price: sellPrice,
                recommended_discount: recommendedDiscount,
                est_profit_after_discount: estProfitAfterDiscount,
                action_hint: actionHint
            };
        });

        const alerts = [];
        if (alertsReadyResult.rows.length > 0) {
            const r = alertsReadyResult.rows[0];
            const buyPrice = parseNum(r.purchase_price);
            const sellPrice = parseNum(r.est_sell_price);
            const potentialProfit = Math.max(0, sellPrice - buyPrice);
            const suggestedCut = potentialProfit > 200000
                ? Math.round((potentialProfit * 0.35) / 50000) * 50000
                : 0;
            alerts.push({
                item_id: parseNum(r.id),
                item: r.model_name,
                days: parseNum(r.days),
                type: 'Ready',
                purchase_price: buyPrice,
                est_sell_price: sellPrice,
                potential_profit: potentialProfit,
                action_hint: suggestedCut > 0
                    ? `Saran diskon ${formatIdrCompact(suggestedCut)} (sisa cuan ${formatIdrCompact(potentialProfit - suggestedCut)})`
                    : 'Evaluasi harga jual atau buat paket bundling'
            });
        }
        for (const r of alertsRepairResult.rows.slice(0, 2)) {
            const buyPrice = parseNum(r.purchase_price);
            const sellPrice = parseNum(r.est_sell_price);
            const potentialProfit = Math.max(0, sellPrice - buyPrice);
            alerts.push({
                item_id: parseNum(r.id),
                item: r.model_name,
                days: parseNum(r.days),
                type: 'Repair',
                purchase_price: buyPrice,
                est_sell_price: sellPrice,
                potential_profit: potentialProfit,
                action_hint: potentialProfit > 0
                    ? `Prioritaskan servis • Potensi cuan +${formatIdrCompact(potentialProfit)}`
                    : 'Segera cek status perbaikan agar modal tidak tertahan'
            });
        }

        const repairBottlenecks = alertsRepairResult.rows.map((row, idx) => {
            const buyPrice = parseNum(row.purchase_price);
            const sellPrice = parseNum(row.est_sell_price);
            const potentialProfit = Math.max(0, sellPrice - buyPrice);
            const dio = row.avg_dio_days ? Number(parseNum(row.avg_dio_days).toFixed(1)) : null;
            const repairDays = parseNum(row.days);

            let priorityReason = '';
            if (dio !== null && potentialProfit > 0) {
                priorityReason = `⚡ Laku rata-rata ${dio} hr · Est. Cuan +${formatIdrCompact(potentialProfit)}`;
            } else if (potentialProfit > 0) {
                priorityReason = `💰 Potensi cuan +${formatIdrCompact(potentialProfit)} setelah selesai servis`;
            } else {
                priorityReason = `⏱️ Tertahan ${repairDays} hari — segera cairkan modal`;
            }

            return {
                drone_id: parseNum(row.id),
                name: row.sub_model_name ? `${row.model_name} (${row.sub_model_name})` : row.model_name,
                repair_days: repairDays,
                purchase_price: buyPrice,
                est_sell_price: sellPrice,
                potential_profit: potentialProfit,
                avg_days_to_sell: dio,
                notes: row.notes || '',
                priority_rank: idx + 1,
                priority_reason: priorityReason
            };
        });

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

        const businessWalletData = businessWalletResult.rows[0] || {};
        const readyRow = stockReadyResult.rows[0] || {};
        const repairRow = stockRepairResult.rows[0] || {};

        const responseData = {
            sales_overview: {
                total_sales: totalSales,
                total_profit: totalProfit,
                settled_profit: settledProfit,
                pending_profit: pendingProfit,
                projected_profit: projectedProfit,
                profit_change_percentage: profitChange,
                is_profit_up: isProfitUp
            },
            stock_cards: [
                {
                    title: "Ready Stock",
                    total_monetary_value: parseNum(readyRow.total_value),
                    total_count: parseNum(readyRow.total_count),
                    potential_sell_value: 0,
                    potential_profit: 0,
                    aging_breakdown: {
                        fresh_count: parseNum(readyRow.fresh_count),
                        fresh_value: parseNum(readyRow.fresh_value),
                        watch_count: parseNum(readyRow.watch_count),
                        watch_value: parseNum(readyRow.watch_value),
                        critical_count: parseNum(readyRow.critical_count),
                        critical_value: parseNum(readyRow.critical_value),
                        dead_count: parseNum(readyRow.dead_count),
                        dead_value: parseNum(readyRow.dead_value)
                    }
                },
                {
                    title: "Repair Stock",
                    total_monetary_value: parseNum(repairRow.total_value),
                    total_count: parseNum(repairRow.total_count),
                    potential_sell_value: parseNum(repairRow.potential_sell_value),
                    potential_profit: parseNum(repairRow.potential_profit),
                    overdue_repair_count: parseNum(repairRow.overdue_repair_count),
                    aging_breakdown: {
                        fresh_count: parseNum(repairRow.fresh_count),
                        fresh_value: parseNum(repairRow.fresh_value),
                        watch_count: parseNum(repairRow.watch_count),
                        watch_value: parseNum(repairRow.watch_value),
                        critical_count: parseNum(repairRow.critical_count),
                        critical_value: parseNum(repairRow.critical_value),
                        dead_count: parseNum(repairRow.dead_count),
                        dead_value: parseNum(repairRow.dead_value)
                    }
                },
                {
                    title: "Accessory Value",
                    total_monetary_value: parseNum(accessoryResult.rows[0].total_value),
                    total_count: parseNum(accessoryResult.rows[0].total_count),
                    potential_sell_value: 0,
                    potential_profit: 0
                }
            ],
            business_wallet: {
                cash_available: parseNum(businessWalletData.cash_available),
                pending_cash: parseNum(businessWalletData.pending_cash),
                pending_count: parseNum(businessWalletData.pending_count),
                savings_debt: parseNum(businessWalletData.savings_debt)
            },
            analytics_previews: [
                {
                    card_id: "top_selling",
                    card_type: "list_ranking",
                    title: "Top Selling Model",
                    description: "Penjualan terbanyak 30 hari terakhir",
                    data: topSellingData
                },
                {
                    card_id: "sales_velocity",
                    card_type: "list_velocity",
                    title: "Kecepatan Laku per Model",
                    description: `Rata-rata hari unit terjual sejak masuk stok (Avg: ${overallAvgDays} hari)`,
                    trend_indicator: velocityTrendIndicator,
                    data: velocityData
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
                    title: "Kesehatan Umur Stok & Likuidasi",
                    description: "Unit Ready mengendap > 3 bulan (Pantau, Kritis, & Stok Mati)",
                    data: slowMovingData
                }
            ],
            alerts: alerts,
            repair_bottlenecks: repairBottlenecks,
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
