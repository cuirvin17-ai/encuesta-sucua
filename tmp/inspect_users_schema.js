const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'Betoben1',
      database: 'encuesta_sucua_bd'
    });
    const [rows] = await conn.execute(
      "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' ORDER BY ORDINAL_POSITION"
    );
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
