const { Pool } = require('pg');
const mysql = require('mysql2');

const PG_URL = 'postgresql://encuesta_sucua_user:9pRBL1X0GBg2mBN0YYAIRrt2U3FZ0eSz@dpg-dacue12d0e5s73fh73e0-a.virginia-postgres.render.com/encuesta_sucua';

async function migrate() {
    const pg = new Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
    const myConn = mysql.createConnection({ host: 'localhost', user: 'root', password: 'Betoben1', database: 'encuesta_sucua_bd' });
    const myQuery = (sql) => new Promise((resolve, reject) => myConn.query(sql, (e, r) => e ? reject(e) : resolve(r)));

    try {
        // 1. Drop & recreate tables
        console.log('🔄 Recreating tables...');
        await pg.query('DROP TABLE IF EXISTS respuestas CASCADE');
        await pg.query('DROP TABLE IF EXISTS votos CASCADE');
        await pg.query('DROP TABLE IF EXISTS preguntas CASCADE');
        await pg.query('DROP TABLE IF EXISTS candidatos CASCADE');
        await pg.query('DROP TABLE IF EXISTS dignidad_config CASCADE');
        await pg.query('DROP TABLE IF EXISTS sistema_config CASCADE');
        await pg.query('DROP TABLE IF EXISTS usuarios CASCADE');

        await pg.query(`
            CREATE TABLE usuarios (
                id SERIAL PRIMARY KEY,
                cedula VARCHAR(20),
                usuario VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                rol VARCHAR(50) DEFAULT 'encuestador',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pg.query(`CREATE TABLE sistema_config (clave VARCHAR(64) PRIMARY KEY, valor VARCHAR(255) NOT NULL DEFAULT '0')`);
        await pg.query(`CREATE TABLE dignidad_config (clave VARCHAR(64) PRIMARY KEY, habilitada BOOLEAN NOT NULL DEFAULT TRUE)`);
        await pg.query(`
            CREATE TABLE candidatos (
                id SERIAL PRIMARY KEY,
                dignidad VARCHAR(40) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                foto VARCHAR(255) NOT NULL DEFAULT 'placeholder-candidato.svg',
                zona VARCHAR(100),
                orden INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pg.query(`CREATE INDEX idx_dignidad ON candidatos(dignidad)`);
        await pg.query(`CREATE INDEX idx_dignidad_zona ON candidatos(dignidad, zona)`);
        await pg.query(`
            CREATE TABLE preguntas (
                id SERIAL PRIMARY KEY,
                pregunta TEXT NOT NULL,
                activa BOOLEAN NOT NULL DEFAULT TRUE,
                orden INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pg.query(`
            CREATE TABLE votos (
                id SERIAL PRIMARY KEY,
                zona VARCHAR(100) NOT NULL,
                rango_edad VARCHAR(20) NOT NULL,
                dignidad VARCHAR(150) NOT NULL,
                candidato VARCHAR(150) NOT NULL,
                id_encuestador INT NOT NULL REFERENCES usuarios(id),
                genero VARCHAR(20) NOT NULL,
                nivel_instruccion VARCHAR(20),
                ocupacion VARCHAR(30),
                problema_principal VARCHAR(40),
                medio_informacion VARCHAR(25),
                latitud DECIMAL(10,7),
                longitud DECIMAL(10,7),
                fecha_voto TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pg.query(`
            CREATE TABLE respuestas (
                id SERIAL PRIMARY KEY,
                id_voto INT NOT NULL REFERENCES votos(id) ON DELETE CASCADE,
                id_pregunta INT NOT NULL REFERENCES preguntas(id) ON DELETE CASCADE,
                respuesta VARCHAR(30) NOT NULL
            )
        `);

        // 2. Migrate data
        // usuarios
        const usuarios = await myQuery('SELECT * FROM usuarios');
        for (const u of usuarios) {
            await pg.query(
                'INSERT INTO usuarios (id, cedula, usuario, password, rol, fecha_creacion) VALUES ($1,$2,$3,$4,$5,$6)',
                [u.id, u.cedula, u.usuario, u.password, u.rol, u.fecha_creacion]
            );
        }
        await pg.query(`SELECT setval('usuarios_id_seq', (SELECT MAX(id) FROM usuarios))`);
        console.log(`✅ ${usuarios.length} usuarios migrados`);

        // sistema_config
        const configs = await myQuery('SELECT * FROM sistema_config');
        for (const c of configs) {
            await pg.query('INSERT INTO sistema_config (clave, valor) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.clave, c.valor]);
        }
        console.log(`✅ ${configs.length} configs migradas`);

        // dignidad_config
        const dignidades = await myQuery('SELECT * FROM dignidad_config');
        for (const d of dignidades) {
            await pg.query('INSERT INTO dignidad_config (clave, habilitada) VALUES ($1,$2) ON CONFLICT DO NOTHING', [d.clave, !!d.habilitada]);
        }
        console.log(`✅ ${dignidades.length} dignidades migradas`);

        // candidatos
        const candidatos = await myQuery('SELECT * FROM candidatos');
        for (const c of candidatos) {
            await pg.query(
                'INSERT INTO candidatos (id, dignidad, nombre, foto, zona, orden, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                [c.id, c.dignidad, c.nombre, c.foto, c.zona, c.orden, c.created_at]
            );
        }
        await pg.query(`SELECT setval('candidatos_id_seq', (SELECT MAX(id) FROM candidatos))`);
        console.log(`✅ ${candidatos.length} candidatos migrados`);

        // preguntas
        const preguntas = await myQuery('SELECT * FROM preguntas');
        for (const p of preguntas) {
            await pg.query(
                'INSERT INTO preguntas (id, pregunta, activa, orden, created_at) VALUES ($1,$2,$3,$4,$5)',
                [p.id, p.pregunta, !!p.activa, p.orden, p.created_at]
            );
        }
        await pg.query(`SELECT setval('preguntas_id_seq', (SELECT MAX(id) FROM preguntas))`);
        console.log(`✅ ${preguntas.length} preguntas migradas`);

        // votos
        const votos = await myQuery('SELECT * FROM votos ORDER BY id');
        for (const v of votos) {
            await pg.query(
                `INSERT INTO votos (id, zona, rango_edad, dignidad, candidato, id_encuestador, genero, nivel_instruccion, ocupacion, problema_principal, medio_informacion, latitud, longitud, fecha_voto)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [v.id, v.zona, v.rango_edad, v.dignidad, v.candidato, v.id_encuestador, v.genero, v.nivel_instruccion, v.ocupacion, v.problema_principal, v.medio_informacion, v.latitud, v.longitud, v.fecha_voto]
            );
        }
        await pg.query(`SELECT setval('votos_id_seq', (SELECT MAX(id) FROM votos))`);
        console.log(`✅ ${votos.length} votos migrados`);

        // respuestas
        const respuestas = await myQuery('SELECT * FROM respuestas ORDER BY id');
        for (const r of respuestas) {
            await pg.query(
                'INSERT INTO respuestas (id, id_voto, id_pregunta, respuesta) VALUES ($1,$2,$3,$4)',
                [r.id, r.id_voto, r.id_pregunta, r.respuesta]
            );
        }
        await pg.query(`SELECT setval('respuestas_id_seq', (SELECT MAX(id) FROM respuestas))`);
        console.log(`✅ ${respuestas.length} respuestas migradas`);

        console.log('\n🎉 ¡Migración completa!');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await pg.end();
        myConn.end();
    }
}

migrate();
