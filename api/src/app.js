require('dotenv').config({ path: '../.env' }); //loads the env file
const express = require('express'); //routing & request response
const cors = require('cors');
const cookieParser = require('cookie-parser'); //packages & reads a cookie
const { requireSession } = require('./middleware/requireSession');
const { withTenant } = require('./db/withTenant');


//starting the actual server
const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
//
app.use(express.json());
//reads the cookie header
app.use(cookieParser());

//health check route
app.get('/health', (req, res) => res.json({ ok: true }));

//connects to the URl
app.use('/api/auth', require('./routes/auth'));

//endpoint that gets the student List
app.get('/api/students', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    //query the db for students
    client.query('SELECT id, admission_no, full_name, class_label FROM students ORDER BY admission_no')
  );
  //return the res in json format
  res.json({ data: result.rows, error: null });
});

//endpoint for connection of the fee-items 
app.use('/api/fee-items', require('./routes/feeItems'));

//endpoint that retruns the totol from balance and cahrges from grouped by category
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

// Full statement: charges, payments and adjustments in one timeline
app.get('/api/students/:id/ledger', requireSession, async (req, res) => {
  const data = await withTenant(req.ctx.tenantId, async (client) => {
    const student = await client.query(
      'SELECT id, admission_no, full_name, class_label FROM students WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!student.rows[0]) return null;

    const entries = await client.query(
      `SELECT 'charge' AS type, c.id, c.amount_minor, c.created_at,
              fi.label AS description, fi.category, NULL AS actor, NULL AS reference
       FROM charges c
       JOIN fee_items fi ON fi.id = c.fee_item_id
       WHERE c.student_id = $1

       UNION ALL

       SELECT 'payment', p.id, -p.amount_minor, p.created_at,
              p.status, NULL, NULL, p.provider_ref
       FROM payments p
       WHERE p.student_id = $1 AND p.status = 'settled'

       UNION ALL

       SELECT 'adjustment', a.id, a.amount_minor, a.created_at,
              a.reason, a.kind, u.email, NULL
       FROM adjustments a
       JOIN users u ON u.id = a.actor_user_id
       WHERE a.student_id = $1

       ORDER BY created_at`,
      [req.params.id]
    );

    const balance = await client.query(
      `SELECT charged_minor, paid_minor, adjusted_minor, balance_minor
       FROM student_balances WHERE student_id = $1`,
      [req.params.id]
    );

    return {
      student: student.rows[0],
      balance: balance.rows[0],
      entries: entries.rows,
    };
  });

  if (!data) {
    return res.status(404).json({
      data: null, error: { message: 'Student not found', code: 'NOT_FOUND' }
    });
  }
  res.json({ data, error: null });
});

//connects charges routes
app.use('/api/charges', require('./routes/charges'));

app.use('/webhook/ussd', express.urlencoded({ extended: false }), require('./routes/ussd'));

app.use('/webhook/mpesa/callback', require('./routes/mpesaCallback'));

app.use('/webhook/whatsapp', express.urlencoded({ extended: false }), require('./routes/whatsapp'));

app.use('/api/adjustments', require('./routes/adjustments'));

app.use('/api/audit-logs', require('./routes/auditLogs'));

app.use('/api/payments', require('./routes/payments'));

app.use('/api/guardians', require('./routes/guardians'));

app.use('/api/payroll', require('./routes/payroll'));

app.use('/api/staff', require('./routes/staff'));

app.use('/api/announcements', require('./routes/announcements'));

app.use('/api/events', require('./routes/events'));


//start the server listening for the request
app.listen(process.env.PORT || 4000, () => {
  console.log(`API on ${process.env.PORT || 4000}`);
});