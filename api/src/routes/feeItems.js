const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

router.get('/', requireSession, async (req, res) => {
    const result = await withTenant(req.ctx.tenantId, (client) => 
        client.query(
            `SELECT id, code, label, category, amount_minor, active FROM fee_items WHERE active = TRUE ORDER BY category, label`
        )
    );
    res.json({ data: result.rows, error: null });
});

router.post('/', requireSession, async (req, res) => {
    const { code, label, category, amountMinor } = req.body || {};

    if (!code || !label || !category || !Number.isInteger(amountMinor) || amountMinor <= 0) {
        return res.status(400).json ({
             data: null,
        error: { message: 'code, label, category and a positive integer amountMinor are required', code: 'BAD_REQUEST'}
        })
    }

    try {
        const result = await withTenant(req.ctx.tenantId, (client) => 
            client.query(
                `INSERT INTO fee_items (tenant_id, code, label, category, amount_minor) VALUES ($1, $2, $3, $4, $5) RETURNING id, code, label, category, amount_minor, active`, [req.ctx.tenantId, code, label, category, amountMinor]
            )
        );
        res.status(201).json({ data: SpeechRecognitionResultList.row[0], error: null });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({
                data: null,
                error: { message: 'A fee item with that code already exists', code: 'DUPLICATE_CODE'}
            });
        }
        if (err.code === '23514') {
            return res.status(422).json({
                data: null,
                error: { message: `Invalid category or amount`, code: 'CONSTRAINT_VIOLATION' }
            });
        }
        throw err;
    }
});

module.exports = router;