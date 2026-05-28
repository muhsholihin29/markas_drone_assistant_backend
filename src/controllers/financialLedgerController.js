const db = require('../config/db');

const cashInTypes = {
    SALE: 'Sales',
    LOAN_TAKEN: 'Loan In',
    CAPITAL_INJECTION: 'Capital',
    REFUND: 'Refund'
};

const cashOutTypes = {
    PURCHASE: 'Purchase',
    REPAIR: 'Repair',
    LOAN_REPAYMENT: 'Loan Out',
    PRIVE: 'Prive'
};

const actionTypeMap = {
    'take-loan': 'LOAN_TAKEN',
    'payback-loan': 'LOAN_REPAYMENT',
    'inject-capital': 'CAPITAL_INJECTION',
    'withdraw-profit': 'PRIVE'
};

const parseNum = (val) => Number(val) || 0;

const getSignedAmountSql = (alias = '') => {
    const prefix = alias ? `${alias}.` : '';

    return `
    CASE
        WHEN ${prefix}type IN ('SALE', 'CAPITAL_INJECTION', 'LOAN_TAKEN', 'REFUND') THEN ABS(${prefix}total_amount)
        WHEN ${prefix}type IN ('PURCHASE', 'LOAN_REPAYMENT', 'REPAIR', 'PRIVE') THEN -ABS(${prefix}total_amount)
        ELSE 0
    END
`;
};

const getFinancialLedger = async (req, res) => {
    try {
        const month = Number(req.query.month);
        const year = Number(req.query.year);

        if (!Number.isInteger(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: 'month wajib berupa angka 1-12' });
        }

        if (!Number.isInteger(year) || year < 1900) {
            return res.status(400).json({ error: 'year wajib berupa angka yang valid' });
        }

        const [
            headerResult,
            cashInResult,
            cashOutResult,
            recentTransactionsResult
        ] = await Promise.all([
            db.query(`
                SELECT
                    COALESCE(SUM(${getSignedAmountSql()}), 0)::numeric AS cash_available,
                    COALESCE(SUM(CASE
                        WHEN type = 'LOAN_TAKEN' THEN ABS(total_amount)
                        WHEN type = 'LOAN_REPAYMENT' THEN -ABS(total_amount)
                        ELSE 0
                    END), 0)::numeric AS loan_balance
                FROM transactions
            `),
            db.query(`
                SELECT type, COALESCE(SUM(ABS(total_amount)), 0)::numeric AS amount
                FROM transactions
                WHERE type = ANY($1)
                  AND EXTRACT(MONTH FROM date) = $2
                  AND EXTRACT(YEAR FROM date) = $3
                GROUP BY type
            `, [Object.keys(cashInTypes), month, year]),
            db.query(`
                SELECT type, COALESCE(SUM(ABS(total_amount)), 0)::numeric AS amount
                FROM transactions
                WHERE type = ANY($1)
                  AND EXTRACT(MONTH FROM date) = $2
                  AND EXTRACT(YEAR FROM date) = $3
                GROUP BY type
            `, [Object.keys(cashOutTypes), month, year]),
            db.query(`
                WITH ledger AS (
                    SELECT
                        t.id,
                        t.type,
                        t.date,
                        t.total_amount,
                        t.notes,
                        SUM(${getSignedAmountSql('t')}) OVER (
                            ORDER BY t.date ASC, t.id ASC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        )::numeric AS balance_after
                    FROM transactions t
                )
                SELECT
                    l.id,
                    l.type,
                    l.date,
                    ABS(l.total_amount)::numeric AS amount,
                    l.balance_after,
                    COALESCE(
                        (
                            SELECT dm.model_name
                            FROM transaction_items ti
                            JOIN drones d ON ti.item_id = d.id
                            JOIN drone_models dm ON d.model_id = dm.id
                            WHERE ti.transaction_id = l.id
                              AND ti.item_type = 'Drone'
                            LIMIT 1
                        ),
                        (
                            SELECT acc.name
                            FROM transaction_items ti
                            JOIN accessory_items ai ON ti.item_id = ai.id
                            JOIN accessories acc ON ai.accessory_id = acc.id
                            WHERE ti.transaction_id = l.id
                              AND ti.item_type = 'Accessory'
                            LIMIT 1
                        ),
                        l.notes,
                        ''
                    ) AS subtitle
                FROM ledger l
                WHERE EXTRACT(MONTH FROM l.date) = $1
                  AND EXTRACT(YEAR FROM l.date) = $2
                ORDER BY l.date DESC, l.id DESC
                LIMIT 10
            `, [month, year])
        ]);

        const headerData = headerResult.rows[0] || {};
        const cashInByType = new Map(cashInResult.rows.map(row => [row.type, parseNum(row.amount)]));
        const cashOutByType = new Map(cashOutResult.rows.map(row => [row.type, parseNum(row.amount)]));

        res.json({
            header: {
                cash_available: parseNum(headerData.cash_available),
                loan_balance: parseNum(headerData.loan_balance),
                currency_symbol: 'Rp '
            },
            cash_in: Object.entries(cashInTypes).map(([type, label]) => ({
                label,
                amount: cashInByType.get(type) || 0
            })),
            cash_out: Object.entries(cashOutTypes).map(([type, label]) => ({
                label,
                amount: cashOutByType.get(type) || 0
            })),
            recent_transactions: recentTransactionsResult.rows.map(row => {
                const isCashIn = Object.prototype.hasOwnProperty.call(cashInTypes, row.type);
                return {
                    id: row.id,
                    title: cashInTypes[row.type] || cashOutTypes[row.type] || row.type,
                    subtitle: row.subtitle || '',
                    date: row.date,
                    amount: parseNum(row.amount),
                    balance_after: parseNum(row.balance_after),
                    type: isCashIn ? 'IN' : 'OUT'
                };
            })
        });
    } catch (err) {
        console.error('Get Financial Ledger Error:', err);
        res.status(500).json({ error: err.message });
    }
};

const submitLedgerAction = async (req, res) => {
    try {
        const { action } = req.params;
        const transactionType = actionTypeMap[action];

        if (!transactionType) {
            return res.status(400).json({ error: 'action tidak valid' });
        }

        const amount = Number(req.body.amount);
        const { date, note, counterparty } = req.body;

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'amount wajib berupa angka lebih dari 0' });
        }

        if (!date || Number.isNaN(Date.parse(date))) {
            return res.status(400).json({ error: 'date wajib berupa string ISO8601 yang valid' });
        }

        const notes = [note, counterparty ? `Counterparty: ${counterparty}` : null]
            .filter(Boolean)
            .join(' | ');

        await db.query(`
            INSERT INTO transactions (type, date, total_amount, total_cogs, notes, platform)
            VALUES ($1, $2, $3, 0, $4, NULL)
        `, [transactionType, date, amount, notes || null]);

        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Submit Ledger Action Error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getFinancialLedger,
    submitLedgerAction
};
