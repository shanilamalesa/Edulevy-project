const { pool } = require('./pool');

async function withTenant(tenantId, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;

    }catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }finally {
        client.release();
    }
}

module.exports = { withTenant };