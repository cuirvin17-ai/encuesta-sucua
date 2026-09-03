const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'Betoben1',
      database: 'encuesta_sucua_bd'
    });
    const [rows] = await conn.execute('SELECT id, usuario, rol FROM usuarios ORDER BY fecha_creacion DESC LIMIT 10');
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
