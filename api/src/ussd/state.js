const redis = require('../db/redis');

const TTL = 180;   // AT sessions die after -3 minutes

async function getState(sessionId) {
    const raw = await redis.get(`ussd:${sessionId}`);
    return raw ? JSON.parse(raw) : { step: 'ENTRY' };
}

async function setState(sessionId, state) {
    await redis.set(`ussd:${sessionId}`, JSON.stringify(state), 'EX', TTL);
}

module.exports = { getState, setState };
