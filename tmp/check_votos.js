const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  try {
    const c = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'encuesta_sucua_bd'
    });
    const [r] = await c.execute(
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'votos'",
      [process.env.DB_NAME || 'encuesta_sucua_bd']
    );
    console.log(JSON.stringify(r, null, 2));

    // Test the actual query
    try {
      const [rows] = await c.execute(
        `SELECT v.id_voto, v.latitud, v.longitud, v.candidato, v.dignidad, v.zona,
                v.fecha_voto, u.nombre AS encuestador
         FROM votos v
         LEFT JOIN usuarios u ON v.id_encuestador = u.id
         WHERE v.latitud IS NOT NULL AND v.longitud IS NOT NULL
         ORDER BY v.fecha_voto DESC LIMIT 5`
      );
      console.log('Query result:', JSON.stringify(rows, null, 2));
    } catch (err) {
      console.error('Query error:', err.message);
    }

    await c.end();
  } catch (err) {
    console.error('Connection error:', err.message);
  }
})();
