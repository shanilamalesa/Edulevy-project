const crypto = require('crypto');
const redis = require('../db/redis');

const IDLE_TTL = 1800;  //30 minutes
const ABSOLUTE_TTL = 43200;   //12 hours

async function createSession({ userId, tenantId, role }) {
    const sid = crypto.randomBytes(32).toString('base64url');
    const record = {
        userId, tenantId, role,
        issuedAt: Date.now(),
        absoluteExp: Date.now() + ABSOLUTE_TTL * 1000,
    };
    await redis.set(`sess:${sid}`, JSON.stringify(record), 'EX', IDLE_TTL);
    return sid;
}

async function readSession(sid) {
    const raw = await redis.get(`sess:${sid}`);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (Date.now() > record.absoluteExp) {
        await redis.del(`sess:${sid}`);
        return null;
    }
    await redis.expire(`sess:${sid}`, IDLE_TTL);  //rolling refresh
    return record;
}

async function destroySession(sid) {
    await redis.del(`sess:${sid}`);
}

module.exports = { createSession, readSession, destroySession };