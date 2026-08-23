require('dotenv').config({ path: '../.env' });
const express = require('express');
const cookieParser = require('cookie-parser');
const { requireSession } = require('./middleware/requireSession');
const { withTenant } = require('./db/withTenant');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));

app.get('/api/students', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query('SELECT id, admission_no, full_name, class_label FROM students ORDER BY admission_no')
  );
  res.json({ data: result.rows, error: null });
});

app.use('/api/fee-items', require('./routes/feeItems'));

app.get('/api/students/:id/balance', requireSession, async (req, res) => {
  const data = await withTenant(req.ctx.tenantId, async (client) => {
    const totals = await client.query(
      `SELECT charged_minor, paid_minor, adjusted_minor, balance_minor FROM student_balances WHERE student_id = $1`,
      [req.params.id]
    );
    if (!totals.rows[0]) return null;

    const byCategory = await client.query(
      `SELECT fi.category,
        SUM(c.amount_minor) AS charged_minor
      FROM charges c
      JOIN fee_items fi ON fi.id = c.fee_item_id
      WHERE c.student_id = $1
      GROUP BY fi.category
      ORDER BY fi.category`,
      [req.params.id]
    );

    return { ...totals.rows[0], byCategory: byCategory.rows };
  });

  if (!data) {
    return res.status(404).json({
      data: null,
      error: { message: 'Student not found', code: 'NOT_FOUND' }
    });
  }
  res.json({ data, error: null });
});

app.use('/api/charges', require('./routes/charges'));

app.listen(process.env.PORT || 4000, () => {
  console.log(`API on ${process.env.PORT || 4000}`);
});