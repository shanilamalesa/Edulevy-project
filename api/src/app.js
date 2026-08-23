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
    client.query('SELECT admission_no, full_name, class_label FROM students ORDER BY admission_no')
  );
  res.json({ data: result.rows, error: null });
});

app.listen(process.env.PORT || 4000, () => {
  console.log(`API on ${process.env.PORT || 4000}`);
});