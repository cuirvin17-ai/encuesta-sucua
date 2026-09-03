const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://encuesta_sucua_user:9pRBL1X0GBg2mBN0YYAIRrt2U3FZ0eSz@dpg-dacue12d0e5s73fh73e0-a.virginia-postgres.render.com/encuesta_sucua';

async function test() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE usuario = 'admin' AND password = 'admin123'");
        console.log('Resultado:', result.rows);
        
        const all = await pool.query('SELECT usuario, password, rol FROM usuarios');
        console.log('Todos los usuarios:', all.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

test();
