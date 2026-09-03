const { Pool } = require('pg');
const fs = require('fs');

const DATABASE_URL = 'postgresql://encuesta_sucua_user:9pRBL1X0GBg2mBN0YYAIRrt2U3FZ0eSz@dpg-dacue12d0e5s73fh73e0-a.virginia-postgres.render.com/encuesta_sucua';

async function migrate() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        const sql = fs.readFileSync('encuesta_postgres_clean.sql', 'utf8');
        await pool.query(sql);
        console.log('✅ Migración exitosa');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

migrate();
