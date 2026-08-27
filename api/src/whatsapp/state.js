const redis = require('../db/redis');

const TTL = 900;   // 15 minutes — WhatsApp has no session, so be generous

async function getState(from) {
  const raw = await redis.get(`wa:${from}`);
  return raw ? JSON.parse(raw) : { step: 'ENTRY' };
}

async function setState(from, state) {
  await redis.set(`wa:${from}`, JSON.stringify(state), 'EX', TTL);
}

async function clearState(from) {
  await redis.del(`wa:${from}`);
}

module.exports = { getState, setState, clearState };