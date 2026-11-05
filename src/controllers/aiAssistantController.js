// src/controllers/aiAssistantController.js
const db = require('../config/db');

function formatMessageRow(row) {
    if (!row) return null;
    let parsedMetadata = {};
    if (row.metadata) {
        if (typeof row.metadata === 'string') {
            try {
                parsedMetadata = JSON.parse(row.metadata);
            } catch (_) {
                parsedMetadata = {};
            }
        } else if (typeof row.metadata === 'object') {
            parsedMetadata = row.metadata;
        }
    }

    return {
        id: Number(row.id),
        session_id: Number(row.session_id),
        role: row.role,
        content: row.content || '',
        status: row.status || 'completed',
        progress_label: row.progress_label || null,
        metadata: parsedMetadata,
        error_message: row.error_message || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

function buildSessionTitle(messageText) {
    const clean = String(messageText || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return 'Diskusi Bisnis Baru';
    return clean.length > 60 ? `${clean.substring(0, 57)}...` : clean;
}

// GET /api/v1/ai-assistant/sessions
const getSessions = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                s.id,
                s.title,
                s.created_at,
                s.updated_at,
                COUNT(m.id)::int AS message_count,
                (
                    SELECT m2.content
                    FROM ai_chat_messages m2
                    WHERE m2.session_id = s.id
                      AND m2.content IS NOT NULL
                      AND LENGTH(TRIM(m2.content)) > 0
                    ORDER BY m2.id DESC
                    LIMIT 1
                ) AS last_message_preview
            FROM ai_chat_sessions s
            LEFT JOIN ai_chat_messages m ON m.session_id = s.id
            GROUP BY s.id, s.title, s.created_at, s.updated_at
            ORDER BY s.updated_at DESC, s.id DESC
            LIMIT 30;
        `);

        res.status(200).json({
            sessions: result.rows.map((r) => ({
                id: Number(r.id),
                title: r.title,
                created_at: r.created_at,
                updated_at: r.updated_at,
                message_count: Number(r.message_count) || 0,
                last_message_preview: r.last_message_preview
                    ? String(r.last_message_preview).substring(0, 120)
                    : '',
            })),
        });
    } catch (err) {
        console.error('Get AI Sessions Error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/v1/ai-assistant/sessions
const createSession = async (req, res) => {
    try {
        const title = req.body && req.body.title ? buildSessionTitle(req.body.title) : 'Diskusi Bisnis Baru';
        const result = await db.query(
            `INSERT INTO ai_chat_sessions (title) VALUES ($1) RETURNING id, title, created_at, updated_at;`,
            [title]
        );
        const row = result.rows[0];
        res.status(201).json({
            id: Number(row.id),
            title: row.title,
            created_at: row.created_at,
            updated_at: row.updated_at,
            message_count: 0,
            last_message_preview: '',
        });
    } catch (err) {
        console.error('Create AI Session Error:', err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/v1/ai-assistant/sessions/:sessionId/messages
const getSessionMessages = async (req, res) => {
    try {
        const sessionId = Number(req.params.sessionId);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
            return res.status(400).json({ error: 'sessionId tidak valid' });
        }

        const sessionRes = await db.query(
            `SELECT id, title, created_at, updated_at FROM ai_chat_sessions WHERE id = $1;`,
            [sessionId]
        );
        if (sessionRes.rowCount === 0) {
            return res.status(404).json({ error: 'Sesi percakapan tidak ditemukan' });
        }

        const messagesRes = await db.query(
            `SELECT id, session_id, role, content, status, progress_label, metadata, error_message, created_at, updated_at
             FROM ai_chat_messages
             WHERE session_id = $1
             ORDER BY id ASC;`,
            [sessionId]
        );

        res.status(200).json({
            session: {
                id: Number(sessionRes.rows[0].id),
                title: sessionRes.rows[0].title,
                created_at: sessionRes.rows[0].created_at,
                updated_at: sessionRes.rows[0].updated_at,
            },
            messages: messagesRes.rows.map(formatMessageRow),
        });
    } catch (err) {
        console.error('Get Session Messages Error:', err);
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/v1/ai-assistant/sessions/:sessionId
const deleteSession = async (req, res) => {
    try {
        const sessionId = Number(req.params.sessionId);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
            return res.status(400).json({ error: 'sessionId tidak valid' });
        }

        await db.query(`DELETE FROM ai_chat_sessions WHERE id = $1;`, [sessionId]);
        res.status(200).json({ message: 'Sesi berhasil dihapus' });
    } catch (err) {
        console.error('Delete AI Session Error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/v1/ai-assistant/chat
const sendMessage = async (req, res) => {
    const rawMessage = req.body ? req.body.message : '';
    const requestedSessionId = req.body && req.body.session_id ? Number(req.body.session_id) : null;

    if (!rawMessage || typeof rawMessage !== 'string' || !rawMessage.trim()) {
        return res.status(400).json({ error: 'Pesan pertanyaan wajib diisi' });
    }

    const messageText = rawMessage.trim();
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        let sessionRow = null;
        if (requestedSessionId && Number.isInteger(requestedSessionId) && requestedSessionId > 0) {
            const checkRes = await client.query(
                `SELECT id, title, created_at, updated_at FROM ai_chat_sessions WHERE id = $1 FOR UPDATE;`,
                [requestedSessionId]
            );
            if (checkRes.rowCount > 0) {
                sessionRow = checkRes.rows[0];
            }
        }

        const autoTitle = buildSessionTitle(messageText);

        if (!sessionRow) {
            const createRes = await client.query(
                `INSERT INTO ai_chat_sessions (title) VALUES ($1) RETURNING id, title, created_at, updated_at;`,
                [autoTitle]
            );
            sessionRow = createRes.rows[0];
        } else if (sessionRow.title === 'Diskusi Bisnis Baru') {
            const updateTitleRes = await client.query(
                `UPDATE ai_chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, created_at, updated_at;`,
                [autoTitle, sessionRow.id]
            );
            sessionRow = updateTitleRes.rows[0];
        } else {
            await client.query(`UPDATE ai_chat_sessions SET updated_at = NOW() WHERE id = $1;`, [sessionRow.id]);
        }

        // 1. Insert User Message
        const userMsgRes = await client.query(
            `INSERT INTO ai_chat_messages (session_id, role, content, status)
             VALUES ($1, 'user', $2, 'completed')
             RETURNING id, session_id, role, content, status, progress_label, metadata, error_message, created_at, updated_at;`,
            [sessionRow.id, messageText]
        );

        // 2. Insert Assistant Job Placeholder (status = 'pending')
        // DB trigger trg_ai_assistant_job_notify automatically fires pg_notify('ai_assistant_jobs', ...)
        const assistantMsgRes = await client.query(
            `INSERT INTO ai_chat_messages (session_id, role, content, status, progress_label)
             VALUES ($1, 'assistant', '', 'pending', 'Menghubungkan ke AI Business Analyst...')
             RETURNING id, session_id, role, content, status, progress_label, metadata, error_message, created_at, updated_at;`,
            [sessionRow.id]
        );

        await client.query('COMMIT');

        res.status(202).json({
            session: {
                id: Number(sessionRow.id),
                title: sessionRow.title,
                created_at: sessionRow.created_at,
                updated_at: sessionRow.updated_at,
            },
            user_message: formatMessageRow(userMsgRes.rows[0]),
            assistant_message: formatMessageRow(assistantMsgRes.rows[0]),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Send AI Message Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /api/v1/ai-assistant/messages/:messageId
const getMessageStatus = async (req, res) => {
    try {
        const messageId = Number(req.params.messageId);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ error: 'messageId tidak valid' });
        }

        const result = await db.query(
            `SELECT id, session_id, role, content, status, progress_label, metadata, error_message, created_at, updated_at
             FROM ai_chat_messages
             WHERE id = $1;`,
            [messageId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pesan tidak ditemukan' });
        }

        res.status(200).json(formatMessageRow(result.rows[0]));
    } catch (err) {
        console.error('Get AI Message Status Error:', err);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/v1/ai-assistant/messages/:messageId/retry
const retryMessage = async (req, res) => {
    try {
        const messageId = Number(req.params.messageId);
        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ error: 'messageId tidak valid' });
        }

        const result = await db.query(
            `UPDATE ai_chat_messages
             SET status = 'pending',
                 progress_label = 'Menghubungkan ulang ke AI Business Analyst...',
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND role = 'assistant'
             RETURNING id, session_id, role, content, status, progress_label, metadata, error_message, created_at, updated_at;`,
            [messageId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pesan asisten tidak ditemukan' });
        }

        res.status(200).json(formatMessageRow(result.rows[0]));
    } catch (err) {
        console.error('Retry AI Message Error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getSessions,
    createSession,
    getSessionMessages,
    deleteSession,
    sendMessage,
    getMessageStatus,
    retryMessage,
};
