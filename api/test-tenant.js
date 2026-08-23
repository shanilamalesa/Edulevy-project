require('dotenv').config({ path: '../.env'});
const { withTenant } = require('./src/db/withTenant');

(async () => {
    const rows = await withTenant('41c2bc98-5776-489f-9f10-085fab23bc8a', 
        (client) => client.query('SELECT admission_no, full_name FROM students')
    );
    console.log(rows.rows);
    process.exit(0);
})();