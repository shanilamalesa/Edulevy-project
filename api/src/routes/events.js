const express = require('express');
const { requireSession } = require('../middleware/requireSession');
const { onEvent } = require('../events/bus');

const router = express.Router();

router.get('/', requireSession, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  const tenantId = req.ctx.tenantId;

  // Events are filtered by tenant HERE. The tenant comes from the session,
  // so one school's dashboard cannot receive another's payments.
  const unsubscribe = onEvent((event) => {
    if (event.tenantId !== tenantId) return;
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
  });

  // Proxies drop idle connections; a comment every 25s keeps it open
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;