const Redis = require('ioredis');

// Two connections: a Redis client in subscriber mode cannot run other
// commands, so publishing needs its own.
const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const CHANNEL = 'edulevy:events';

// tenantId travels with the event so each stream only forwards its own
async function publish(tenantId, type, payload) {
  await publisher.publish(CHANNEL, JSON.stringify({ tenantId, type, payload }));
}

const listeners = new Set();

subscriber.subscribe(CHANNEL, (err) => {
  if (err) console.error('event bus subscribe failed:', err.message);
});

subscriber.on('message', (_channel, raw) => {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  for (const fn of listeners) fn(event);
});

function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { publish, onEvent };