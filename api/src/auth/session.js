const crypto = require('crypto'); //for generating random strings
const redis = require('../db/redis');

const IDLE_TTL = 1800;  //30 minutes
const ABSOLUTE_TTL = 43200;   //12 hours in sec

//creating the session once logged in
async function createSession({ userId, tenantId, role }) {
    //generating unguesssable random string
    const sid = crypto.randomBytes(32).toString('base64url');
    const record = {
        userId, tenantId, role,
        issuedAt: Date.now(), //in milliseconds
        absoluteExp: Date.now() + ABSOLUTE_TTL * 1000, //converting ABSOLUTE_TTL in milliseconds
    };
    //storing in redis
    await redis.set(`sess:${sid}`, JSON.stringify(record), 'EX', IDLE_TTL);
      // Index sessions by user so an account can be revoked immediately
    await redis.sadd(`user-sessions:${userId}`, sid);
    await redis.expire(`user-sessions:${userId}`, ABSOLUTE_TTL);
    return sid;
}

//
async function readSession(sid) {
    //fetch the session record from redis
    const raw = await redis.get(`sess:${sid}`);
    if (!raw) return null;
    //converting it from text into object
    const record = JSON.parse(raw);
    if (Date.now() > record.absoluteExp) {
        await redis.del(`sess:${sid}`);
        return null;
    }
    //otherwise refresh the session after every 30 minutes so an active user stays logged in
    await redis.expire(`sess:${sid}`, IDLE_TTL);  //rolling refresh
    //return who they are
    return record;
}

//deleting one redis key logs someone out instanly
//(reason i choose session rather than JWT)
async function destroySession(sid) {
    await redis.del(`sess:${sid}`);
}

module.exports = { createSession, readSession, destroySession };