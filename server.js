/**
 * server.js - Backend Sistema de Encuestas Sucúa 2026
 */

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const ExcelJS  = require('exceljs');
const crypto   = require('crypto');
const path     = require('path');
const rateLimit = require('express-rate-limit');
const multer   = require('multer');
const https    = require('https');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

const noStore = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
};

// ============ 1. CORS ============
app.use(cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

// ============ 2. MIDDLEWARE ============
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    message: '⚠️ Demasiados intentos. Intenta en 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: '⚠️ Demasiados registros. Intenta en 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false
});

const voteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: '⚠️ Demasiados votos en poco tiempo. Intenta nuevamente.',
    standardHeaders: true,
    legacyHeaders: false
});

const apiNoStoreRoutes = [
    '/login',
    '/registrar',
    '/votar',
    '/estado-acceso',
    '/usuarios',
    '/bloqueo-acceso',
    '/reiniciar-encuesta',
    '/dignidades-estado',
    '/dignidades-estado/:clave',
    '/estadisticas',
    '/estadisticas-genero',
    '/estadisticas-edad',
    '/estadisticas-candidato',
    '/candidatos-disponibles',
    '/zonas-disponibles',
    '/descargar-excel',
    '/descargar-excel-dignidades',
    '/descargar-excel-preguntas',
    '/estadisticas-preguntas',
    '/candidatos',
    '/candidatos/:id',
    '/candidatos/subir-foto',
    '/preguntas',
    '/preguntas/:id',
    '/votar-preguntas'
];

app.use(apiNoStoreRoutes, noStore);

// ============ 3. ARCHIVOS ESTÁTICOS ============
const publicPath = path.resolve(__dirname);
// ✅ Ruta pública actualizada al nuevo nombre del proyecto
app.use('/encuesta', express.static(publicPath, {
    maxAge: '0',
    etag: false
}));

// Servir fotos de candidatos
app.use('/encuesta/assets/candidatos', express.static(path.join(publicPath, 'assets', 'candidatos'), {
    maxAge: '7d'
}));

// Proxy de tiles OpenStreetMap (evita bloqueo por referer en ngrok)
app.get('/tile/:z/:x/:y', async (req, res) => {
    const { z, x, y } = req.params;
    const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    try {
        const img = await new Promise((resolve, reject) => {
            https.get(tileUrl, { headers: { 'Referer': 'https://www.openstreetmap.org/', 'User-Agent': 'SucuaVota/1.0' } }, (response) => {
                const chunks = [];
                response.on('data', c => chunks.push(c));
                response.on('end', () => {
                    if (response.statusCode !== 200) { reject(new Error(`Tile status ${response.statusCode}`)); return; }
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', reject);
        });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(img);
    } catch (err) {
        console.error('❌ Tile proxy error:', err.message);
        res.status(502).send('Tile error');
    }
});

// ============ 4. BASE DE DATOS ============
const DATABASE_URL = process.env.DATABASE_URL;
let db;
let pgPool;
let isPostgres = false;

if (DATABASE_URL) {
    // PostgreSQL (Render)
    const { Pool } = require('pg');
    pgPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    isPostgres = true;

    function pgConvert(sql, params = []) {
        let idx = 1;
        let s = sql.replace(/\?/g, () => `$${idx++}`);
        // ON DUPLICATE KEY UPDATE x = VALUES(x) → ON CONFLICT DO UPDATE SET x = EXCLUDED.x
        s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(\w+)\s*=\s*VALUES\(\1\)/g, 'ON CONFLICT DO UPDATE SET $1 = EXCLUDED.$1');
        s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(\w+)\s*=\s*VALUES\(\w+\)/g, 'ON CONFLICT DO UPDATE SET $1 = EXCLUDED.$1');
        // FIELD(x, 'a','b','c') → CASE x WHEN 'a' THEN 1 WHEN 'b' THEN 2 WHEN 'c' THEN 3 END
        s = s.replace(/ORDER BY FIELD\((\w+),\s*'([^']+)'(?:,\s*'([^']+)')*(?:,\s*'([^']+)')*\)/g, (_, col, v1, v2, v3) => {
            let caseExpr = `CASE ${col}`;
            if (v1) caseExpr += ` WHEN '${v1}' THEN 1`;
            if (v2) caseExpr += ` WHEN '${v2}' THEN 2`;
            if (v3) caseExpr += ` WHEN '${v3}' THEN 3`;
            caseExpr += ' END';
            return `ORDER BY ${caseExpr}`;
        });
        // DATE_FORMAT(x, '%d/%m/%Y') → TO_CHAR(x, 'DD/MM/YYYY')
        s = s.replace(/DATE_FORMAT\((\w+\.\w+),\s*'%d\/%m\/%Y'\)/g, "TO_CHAR($1, 'DD/MM/YYYY')");
        s = s.replace(/DATE_FORMAT\((\w+\.\w+),\s*'%H:%i:%s'\)/g, "TO_CHAR($1, 'HH24:MI:SS')");
        return { sql: s, params };
    }

    db = {
        execute: async (sql, params = []) => {
            const converted = pgConvert(sql, params);
            let pgSql = converted.sql;
            let isInsert = /^\s*INSERT\s/i.test(pgSql);
            let isWrite = /^\s*(INSERT|UPDATE|DELETE)\s/i.test(pgSql);
            if (isInsert && !/RETURNING/i.test(pgSql)) {
                pgSql += ' RETURNING id';
            }
            const result = await pgPool.query(pgSql, converted.params);
            if (isInsert && result.rows.length > 0) {
                return [{ insertId: result.rows[0].id, affectedRows: result.rowCount }, result.fields];
            }
            if (isWrite) {
                return [{ affectedRows: result.rowCount }, result.fields];
            }
            return [result.rows, result.fields];
        },
        query: async (sql, params = []) => {
            const converted = pgConvert(sql, params);
            let pgSql = converted.sql;
            let isInsert = /^\s*INSERT\s/i.test(pgSql);
            let isWrite = /^\s*(INSERT|UPDATE|DELETE)\s/i.test(pgSql);
            if (isInsert && !/RETURNING/i.test(pgSql)) {
                pgSql += ' RETURNING id';
            }
            const result = await pgPool.query(pgSql, converted.params);
            if (isInsert && result.rows.length > 0) {
                return [{ insertId: result.rows[0].id, affectedRows: result.rowCount }, result.fields];
            }
            if (isWrite) {
                return [{ affectedRows: result.rowCount }, result.fields];
            }
            return [result.rows, result.fields];
        }
    };
    console.log('✅ PostgreSQL detectado (DATABASE_URL)');
} else {
    // MySQL (local)
    const mysql = require('mysql2');
    const mysqlPool = mysql.createPool({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'Betoben1',
        database: process.env.DB_NAME     || 'encuesta_sucua_bd',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    db = mysqlPool.promise();
    console.log('✅ MySQL detectado (local)');
}

async function initSistemaConfig() {
    try {
        if (isPostgres) {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS sistema_config (
                    clave VARCHAR(64) PRIMARY KEY,
                    valor VARCHAR(255) NOT NULL DEFAULT '0'
                )
            `);
            const [rows] = await db.execute(
                "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado'"
            );
            if (!rows.length) {
                await db.execute(
                    "INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0') ON CONFLICT DO NOTHING"
                );
            }
            return;
        }
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sistema_config (
                clave VARCHAR(64) PRIMARY KEY,
                valor VARCHAR(255) NOT NULL DEFAULT '0'
            )
        `);
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado'"
        );
        if (!rows.length) {
            await db.execute(
                "INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0')"
            );
        }
    } catch (err) {
        console.error('❌ Error init sistema_config:', err.message);
    }
}

/**
 * Asegura que la tabla `votos` tenga la columna `dignidad`.
 * - No crea la tabla completa (se asume que ya existe en tu MySQL).
 * - Si no existe la columna, la agrega con un valor por defecto.
 */
async function asegurarColumnaDignidad() {
    if (isPostgres) return;
    try {
        const [tablas] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos'"
        );
        if (!tablas?.[0] || tablas[0].total === 0) {
            console.warn("⚠️ La tabla 'votos' no existe. No se pudo verificar/agregar columna 'dignidad'.");
            return;
        }

        const [cols] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos' AND COLUMN_NAME = 'dignidad'"
        );
        if (!cols?.[0] || cols[0].total === 0) {
            await db.execute("ALTER TABLE votos ADD COLUMN dignidad VARCHAR(40) NOT NULL DEFAULT 'ALCALDE' AFTER id_voto");
            console.log("✅ Columna 'dignidad' agregada en tabla votos (DEFAULT 'ALCALDE').");
        }
    } catch (err) {
        console.error("❌ Error asegurando columna 'dignidad':", err.message);
    }
}

async function asegurarColumnaPasswordUsuarios() {
    if (isPostgres) return;
    try {
        const [tablas] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'"
        );
        if (!tablas?.[0] || tablas[0].total === 0) {
            console.warn("⚠️ La tabla 'usuarios' no existe. No se pudo verificar/agregar tamaño de 'password'.");
            return;
        }

        const [cols] = await db.execute(
            "SELECT CHARACTER_MAXIMUM_LENGTH AS maxlen FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'password' LIMIT 1"
        );

        const maxLen = Number(cols?.[0]?.maxlen || 0);
        if (!maxLen || maxLen < 255) {
            await db.execute("ALTER TABLE usuarios MODIFY COLUMN password VARCHAR(255) NOT NULL");
            console.log("✅ Columna 'password' ampliada a VARCHAR(255) en tabla usuarios.");
        }
    } catch (err) {
        console.error("❌ Error asegurando columna 'password' en usuarios:", err.message);
    }
}

async function estaAccesoBloqueado() {
    try {
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado' LIMIT 1"
        );
        return rows.length > 0 && rows[0].valor === '1';
    } catch (err) {
        console.error('❌ Error leyendo acceso_bloqueado:', err.message);
        return false;
    }
}

async function setAccesoBloqueado(bloquear) {
    await db.execute(
        `INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [bloquear ? '1' : '0']
    );
}

// ===== Ubicación =====
async function asegurarColumnasUbicacion() {
    if (isPostgres) return;
    try {
        const [tablas] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos'"
        );
        if (!tablas?.[0] || tablas[0].total === 0) return;

        for (const col of ['latitud', 'longitud']) {
            const [cols] = await db.execute(
                "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos' AND COLUMN_NAME = ?", [col]
            );
            if (!cols?.[0] || cols[0].total === 0) {
                await db.execute(`ALTER TABLE votos ADD COLUMN \`${col}\` DECIMAL(10,7) NULL AFTER genero`);
                console.log(`✅ Columna '${col}' agregada en tabla votos.`);
            }
        }

        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'permitir_ubicacion'"
        );
        if (!rows.length) {
            await db.execute(
                "INSERT INTO sistema_config (clave, valor) VALUES ('permitir_ubicacion', '0')"
            );
            console.log("✅ Config 'permitir_ubicacion' creada con valor 0.");
        }
    } catch (err) {
        console.error('❌ Error asegurando columnas ubicación:', err.message);
    }
}

async function asegurarColumnasVotosNuevas() {
    if (isPostgres) return;
    try {
        const [tablas] = await db.execute(
            "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos'"
        );
        if (!tablas?.[0] || tablas[0].total === 0) return;

        const columnas = [
            { name: 'nivel_instruccion', def: 'VARCHAR(20) NULL' },
            { name: 'ocupacion', def: 'VARCHAR(30) NULL' },
            { name: 'problema_principal', def: 'VARCHAR(40) NULL' },
            { name: 'medio_informacion', def: 'VARCHAR(40) NULL' }
        ];
        for (const col of columnas) {
            const [cols] = await db.execute(
                "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votos' AND COLUMN_NAME = ?", [col.name]
            );
            if (!cols?.[0] || cols[0].total === 0) {
                await db.execute(`ALTER TABLE votos ADD COLUMN \`${col.name}\` ${col.def}`);
                console.log(`Columna '${col.name}' agregada en tabla votos.`);
            }
        }
    } catch (err) {
        console.error('Error asegurando nuevas columnas en votos:', err.message);
    }
}

async function asegurarColumnaRespuestas() {
    if (isPostgres) return;
    try {
        const [cols] = await db.execute(
            "SELECT CHARACTER_MAXIMUM_LENGTH AS maxlen FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'respuestas' AND COLUMN_NAME = 'respuesta' LIMIT 1"
        );
        const maxLen = Number(cols?.[0]?.maxlen || 0);
        if (maxLen > 0 && maxLen < 30) {
            await db.execute("ALTER TABLE respuestas MODIFY COLUMN respuesta VARCHAR(30) NOT NULL");
            console.log("Columna 'respuestas.respuesta' ampliada a VARCHAR(30).");
        }
    } catch (err) {
        console.error('Error asegurando columna respuestas.respuesta:', err.message);
    }
}

async function estaUbicacionPermitida() {
    try {
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'permitir_ubicacion' LIMIT 1"
        );
        return rows.length > 0 && rows[0].valor === '1';
    } catch (err) {
        console.error('❌ Error leyendo permitir_ubicacion:', err.message);
        return false;
    }
}

async function setUbicacionPermitida(permitir) {
    await db.execute(
        `INSERT INTO sistema_config (clave, valor) VALUES ('permitir_ubicacion', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [permitir ? '1' : '0']
    );
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'assets', 'candidatos')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(path.extname(file.originalname).toLowerCase());
        cb(null, ok);
    }
});

const DIGNIDADES_CONFIG = ['ALCALDE', 'CONCEJALES_URBANOS', 'CONCEJALES_RURALES', 'JUNTAS_PARROQUIALES', 'PREGUNTAS'];

async function initCandidatosTable() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS candidatos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dignidad VARCHAR(40) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                foto VARCHAR(255) NOT NULL DEFAULT 'placeholder-candidato.svg',
                zona VARCHAR(100) DEFAULT NULL,
                orden INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_dignidad (dignidad),
                INDEX idx_dignidad_zona (dignidad, zona)
            )
        `);
    } catch (err) {
        console.error('❌ Error init candidatos table:', err.message);
    }
}

async function initDignidadesConfig() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS dignidad_config (
                clave VARCHAR(64) PRIMARY KEY,
                habilitada TINYINT(1) NOT NULL DEFAULT 1
            )
        `);

        for (const clave of DIGNIDADES_CONFIG) {
            await db.execute(
                `INSERT INTO dignidad_config (clave, habilitada)
                 VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE clave = clave`,
                [clave]
            );
        }
    } catch (err) {
        console.error('❌ Error init dignidad_config:', err.message);
    }
}

async function initPreguntasTable() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS preguntas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pregunta TEXT NOT NULL,
                activa TINYINT(1) NOT NULL DEFAULT 1,
                orden INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS respuestas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                id_voto INT NOT NULL,
                id_pregunta INT NOT NULL,
                respuesta VARCHAR(20) NOT NULL,
                INDEX idx_id_voto (id_voto),
                FOREIGN KEY (id_voto) REFERENCES votos(id) ON DELETE CASCADE,
                FOREIGN KEY (id_pregunta) REFERENCES preguntas(id) ON DELETE CASCADE
            )
        `);
    } catch (err) {
        console.error('❌ Error init preguntas/respuestas tables:', err.message);
    }
}

async function obtenerEstadoDignidades() {
    try {
        const [rows] = await db.execute(
            "SELECT clave, habilitada FROM dignidad_config ORDER BY FIELD(clave, 'ALCALDE', 'CONCEJALES_URBANOS', 'CONCEJALES_RURALES', 'JUNTAS_PARROQUIALES', 'PREGUNTAS')"
        );
        const mapa = new Map(rows.map(row => [row.clave, Number(row.habilitada) === 1]));
        return DIGNIDADES_CONFIG.map(clave => ({
            clave,
            habilitada: mapa.has(clave) ? mapa.get(clave) : true
        }));
    } catch (err) {
        console.error('❌ Error leyendo dignidad_config:', err.message);
        return DIGNIDADES_CONFIG.map(clave => ({ clave, habilitada: true }));
    }
}

async function estaDignidadHabilitada(clave) {
    if (!DIGNIDADES_CONFIG.includes(clave)) return false;
    try {
        const [rows] = await db.execute(
            'SELECT habilitada FROM dignidad_config WHERE clave = ? LIMIT 1',
            [clave]
        );
        if (!rows.length) return true;
        return Number(rows[0].habilitada) === 1;
    } catch (err) {
        console.error('❌ Error consultando dignidad_config:', err.message);
        return true;
    }
}

async function setDignidadHabilitada(clave, habilitada) {
    if (!DIGNIDADES_CONFIG.includes(clave)) {
        throw new Error('Dignidad inválida');
    }
    await db.execute(
        'INSERT INTO dignidad_config (clave, habilitada) VALUES (?, ?) ON DUPLICATE KEY UPDATE habilitada = VALUES(habilitada)',
        [clave, habilitada ? 1 : 0]
    );
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sesiones = new Map();

function limpiarSesionesExpiradas() {
    const ahora = Date.now();
    for (const [token, sesion] of sesiones.entries()) {
        if (!sesion || sesion.expiresAt <= ahora) {
            sesiones.delete(token);
        }
    }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
    return `pbkdf2$${salt}$${hash}`;
}

function verificarPassword(password, stored) {
    if (typeof stored !== 'string' || typeof password !== 'string') return false;
    if (!stored.startsWith('pbkdf2$')) return password === stored;

    const partes = stored.split('$');
    if (partes.length !== 3) return false;
    const salt = partes[1];
    const hashGuardado = partes[2];
    const hashCalculado = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
    if (hashGuardado.length !== hashCalculado.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hashGuardado, 'hex'), Buffer.from(hashCalculado, 'hex'));
}

function crearSesion(usuario) {
    limpiarSesionesExpiradas();
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, {
        user: {
            id: usuario.id,
            usuario: usuario.usuario,
            rol: usuario.rol,
            cedula: usuario.cedula
        },
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
}

function autenticarSesion(req, res, next) {
    limpiarSesionesExpiradas();
    const auth = req.headers.authorization || '';
    const tokenEncabezado = req.headers['x-session-token'];
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : tokenEncabezado;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Sesión requerida' });
    }

    const sesion = sesiones.get(token);
    if (!sesion) {
        return res.status(401).json({ success: false, message: 'Sesión inválida o expirada' });
    }

    req.auth = { token, user: sesion.user };
    next();
}

function requiereRol(...rolesPermitidos) {
    return (req, res, next) => {
        const rol = req.auth?.user?.rol || '';
        if (!rolesPermitidos.includes(rol)) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para realizar esta acción' });
        }
        next();
    };
}

app.use(['/registrar'], autenticarSesion, requiereRol('admin', 'superadmin'));
app.use(['/votar', '/votar-preguntas', '/candidatos-disponibles', '/zonas-disponibles'], autenticarSesion);
app.use(['/estadisticas', '/estadisticas-genero', '/estadisticas-edad', '/estadisticas-candidato', '/estadisticas-preguntas', '/descargar-excel', '/descargar-excel-dignidades', '/descargar-excel-preguntas', '/usuarios'], autenticarSesion, requiereRol('admin', 'superadmin'));
app.use(['/bloqueo-acceso', '/reiniciar-encuesta'], autenticarSesion, requiereRol('superadmin'));
app.get('/dignidades-estado', autenticarSesion, async (req, res) => {
    try {
        const estado = await obtenerEstadoDignidades();
        res.json({ success: true, dignidades: estado });
    } catch (err) {
        console.error('❌ Error dignidades-estado:', err.message);
        res.status(500).json({ success: false, message: 'Error al consultar dignidades' });
    }
});

function validarCampoBooleano(campo) {
    return (req, res, next) => {
        if (typeof req.body?.[campo] !== 'boolean') {
            return res.status(400).json({ success: false, message: `Parámetro ${campo} requerido (true/false)` });
        }
        next();
    };
}

app.post('/dignidades-estado/:clave', autenticarSesion, requiereRol('superadmin'), validarCampoBooleano('habilitada'), async (req, res) => {
    const clave = String(req.params.clave || '').toUpperCase();
    const { habilitada } = req.body;

    if (!DIGNIDADES_CONFIG.includes(clave)) {
        return res.status(400).json({ success: false, message: 'Dignidad inválida' });
    }

    try {
        await setDignidadHabilitada(clave, habilitada);
        res.json({
            success: true,
            clave,
            habilitada,
            message: `La dignidad ${clave} fue ${habilitada ? 'habilitada' : 'deshabilitada'} correctamente.`
        });
    } catch (err) {
        console.error('❌ Error actualizando dignidad:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la dignidad' });
    }
});

if (isPostgres) {
    console.log('✅ PostgreSQL listo');
    initSistemaConfig();
    initDignidadesConfig();
    initCandidatosTable();
    initPreguntasTable();
} else {
    pool.getConnection((err, connection) => {
        if (err) {
            console.error("❌ Error MySQL:", err.message);
        } else {
            console.log("✅ MySQL conectado");
            connection.release();
            initSistemaConfig();
            asegurarColumnaDignidad();
            asegurarColumnaPasswordUsuarios();
            asegurarColumnasUbicacion();
            asegurarColumnasVotosNuevas();
            asegurarColumnaRespuestas();
            initDignidadesConfig();
            initCandidatosTable();
            initPreguntasTable();
        }
    });
}

// ============ 5. VALIDADORES ============
function validarLogin(req, res, next) {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
        return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
    }
    if (typeof usuario !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: 'Formato inválido de credenciales' });
    }
    next();
}

function validarRegistro(req, res, next) {
    const { cedula, usuario, password, rol } = req.body;
    if (!cedula || !usuario || !password || !rol) {
        return res.status(400).json({ success: false, message: 'Todos los campos son requeridos' });
    }
    if (typeof cedula !== 'string' || typeof usuario !== 'string' || typeof password !== 'string' || typeof rol !== 'string') {
        return res.status(400).json({ success: false, message: 'Formato inválido de registro' });
    }
    const rolesPermitidos = ['admin', 'encuestador'];
    if (!rolesPermitidos.includes(rol)) {
        return res.status(400).json({ success: false, message: 'Rol no permitido' });
    }
    next();
}

function validarVoto(req, res, next) {
    // ✅ dignidad es nueva; si no viene, asumimos ALCALDE para compatibilidad con votos antiguos/offline
    const { zona, rango_edad, candidato, id_encuestador, genero } = req.body;
    if (!zona || !rango_edad || !candidato || !id_encuestador) {
        return res.status(400).json({ success: false, message: 'Faltan datos requeridos' });
    }
    if (!genero) {
        return res.status(400).json({ success: false, message: 'El campo género es requerido' });
    }
    if (!req.body.dignidad) req.body.dignidad = 'ALCALDE';
    if (typeof zona !== 'string' || typeof rango_edad !== 'string' || typeof candidato !== 'string' || typeof genero !== 'string') {
        return res.status(400).json({ success: false, message: 'Formato inválido de voto' });
    }
    next();
}

function validarBooleano(req, res, next) {
    if (typeof req.body?.bloquear !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Parámetro bloquear requerido (true/false)' });
    }
    next();
}

function validarCampoBooleano(campo) {
    return (req, res, next) => {
        if (typeof req.body?.[campo] !== 'boolean') {
            return res.status(400).json({ success: false, message: `Parámetro ${campo} requerido (true/false)` });
        }
        next();
    };
}

// ============ 6. RUTAS ============

// Login
app.post('/login', loginLimiter, validarLogin, async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const [results] = await db.execute(
            'SELECT id, usuario, rol, cedula, password FROM usuarios WHERE usuario = ? LIMIT 1',
            [usuario]
        );
        if (results.length > 0) {
            const user = results[0];
            const passwordOk = verificarPassword(password, user.password);
            if (!passwordOk) {
                return res.status(401).json({ success: false, message: 'Usuario o clave incorrectos' });
            }
            if (user.rol !== 'superadmin' && await estaAccesoBloqueado()) {
                return res.status(403).json({
                    success: false,
                    codigo: 'ACCESO_BLOQUEADO',
                    message: 'El acceso al sistema está bloqueado. Solo el superadministrador puede ingresar.'
                });
            }
            if (!String(user.password || '').startsWith('pbkdf2$')) {
                const nuevoHash = hashPassword(password);
                await db.execute('UPDATE usuarios SET password = ? WHERE id = ?', [nuevoHash, user.id]);
            }
            const token = crearSesion(user);
            res.json({
                success: true,
                token,
                user: { id: user.id, usuario: user.usuario, rol: user.rol, cedula: user.cedula }
            });
        } else {
            res.status(401).json({ success: false, message: 'Usuario o clave incorrectos' });
        }
    } catch (err) {
        console.error("❌ Error login:", err.message);
        res.status(500).json({ success: false, message: "Error servidor" });
    }
});

// Registrar usuario
app.post('/registrar', registerLimiter, validarRegistro, async (req, res) => {
    const { cedula, usuario, password, rol } = req.body;

    if (rol === 'superadmin') {
        return res.status(403).json({ success: false, message: 'No se puede crear una cuenta superadministrador desde aquí' });
    }
    if (await estaAccesoBloqueado()) {
        return res.status(403).json({
            success: false,
            codigo: 'ACCESO_BLOQUEADO',
            message: 'El sistema está bloqueado. No se pueden registrar usuarios.'
        });
    }

    try {
        const [existenteUsuario] = await db.execute('SELECT id FROM usuarios WHERE usuario = ? LIMIT 1', [usuario]);
        if (existenteUsuario.length > 0) {
            return res.status(409).json({ success: false, message: `El usuario "${usuario}" ya existe` });
        }

        if (/^\d{10}$/.test(cedula)) {
            const [existenteCedula] = await db.execute('SELECT id FROM usuarios WHERE cedula = ? LIMIT 1', [cedula]);
            if (existenteCedula.length > 0) {
                return res.status(409).json({ success: false, message: `La cédula ${cedula} ya está registrada` });
            }
        }

        const [result] = await db.execute(
            'INSERT INTO usuarios (cedula, usuario, password, rol) VALUES (?, ?, ?, ?)',
            [cedula, usuario, hashPassword(password), rol]
        );
        res.json({ success: true, message: `Usuario "${usuario}" creado correctamente`, id: result.insertId });

    } catch (err) {
        console.error("❌ Error registrando usuario:", err.message);
        if (err.code === 'ER_DUP_ENTRY' || err.code === '23505') {
            return res.status(409).json({ success: false, message: 'El usuario o cédula ya existe en el sistema' });
        }
        res.status(500).json({ success: false, message: 'Error interno: ' + err.message });
    }
});

// Votar
app.post('/votar', voteLimiter, validarVoto, async (req, res) => {
    const { dignidad, zona, rango_edad, candidato, genero, latitud, longitud, nivel_instruccion, ocupacion } = req.body;
    const idEncuestadorSesion = req.auth?.user?.id;
    if (!idEncuestadorSesion) {
        return res.status(401).json({ success: false, message: 'Sesión requerida' });
    }
    if (await estaAccesoBloqueado()) {
        return res.status(403).json({
            success: false,
            codigo: 'ACCESO_BLOQUEADO',
            message: 'El sistema está bloqueado. No se pueden registrar votos.'
        });
    }
    if (!(await estaDignidadHabilitada(dignidad))) {
        return res.status(403).json({
            success: false,
            codigo: 'DIGNIDAD_DESHABILITADA',
            message: 'La dignidad seleccionada está deshabilitada temporalmente.'
        });
    }
    try {
        const permitirUb = await estaUbicacionPermitida();
        let lat = null, lng = null;
        if (permitirUb && latitud != null && longitud != null) {
            lat = parseFloat(latitud);
            lng = parseFloat(longitud);
            if (isNaN(lat)) lat = null;
            if (isNaN(lng)) lng = null;
        }
        const [result] = await db.execute(
            'INSERT INTO votos (dignidad, zona, rango_edad, candidato, id_encuestador, genero, nivel_instruccion, ocupacion, fecha_voto, latitud, longitud) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
            [dignidad, zona, rango_edad, candidato, idEncuestadorSesion, genero, nivel_instruccion || null, ocupacion || null, lat, lng]
        );
        console.log(`📝 Voto ID: ${result.insertId} | Dignidad: ${dignidad} | Género: ${genero} | Edad: ${rango_edad}${lat ? ' | 📍 con ubicación' : ''}`);
        res.json({ success: true, votoId: result.insertId });
    } catch (err) {
        console.error("❌ Error voto:", err.message);
        res.status(500).json({ success: false, message: "Error al registrar voto" });
    }
});



// Estadísticas generales
app.get('/estadisticas', async (req, res) => {
    try {
        const { zona, dignidad } = req.query;
        let query = 'SELECT candidato, COUNT(*) as total FROM votos WHERE 1=1 AND dignidad != ?';
        const params = ['PREGUNTAS'];
        if (dignidad && dignidad !== 'todas' && dignidad !== 'PREGUNTAS') { query += ' AND dignidad = ?'; params.push(dignidad); }
        if (zona && zona !== 'todas') { query += ' AND zona = ?'; params.push(zona); }
        query += ' GROUP BY candidato ORDER BY total DESC';
        const [results] = await db.execute(query, params);
        res.json(results);
    } catch (err) {
        console.error("❌ Error estadísticas:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Estadísticas por género
app.get('/estadisticas-genero', async (req, res) => {
    try {
        const { zona, dignidad } = req.query;
        let query = 'SELECT genero, COUNT(*) as total FROM votos WHERE genero IS NOT NULL AND dignidad != ?';
        const params = ['PREGUNTAS'];
        if (dignidad && dignidad !== 'todas' && dignidad !== 'PREGUNTAS') { query += ' AND dignidad = ?'; params.push(dignidad); }
        if (zona && zona !== 'todas') {
            query += ' AND zona = ?';
            params.push(zona);
        }
        query += ' GROUP BY genero ORDER BY total DESC';
        const [results] = await db.execute(query, params);
        res.json(results);
    } catch (err) {
        console.error("❌ Error estadísticas género:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Estadísticas por rango de edad
app.get('/estadisticas-edad', async (req, res) => {
    try {
        const { zona, dignidad } = req.query;
        let query = 'SELECT rango_edad, COUNT(*) as total FROM votos WHERE rango_edad IS NOT NULL AND dignidad != ?';
        const params = ['PREGUNTAS'];
        if (dignidad && dignidad !== 'todas' && dignidad !== 'PREGUNTAS') { query += ' AND dignidad = ?'; params.push(dignidad); }
        if (zona && zona !== 'todas') {
            query += ' AND zona = ?';
            params.push(zona);
        }
        query += " GROUP BY rango_edad ORDER BY FIELD(rango_edad, '18-25', '26-40', '+41')";
        const [results] = await db.execute(query, params);
        res.json(results);
    } catch (err) {
        console.error("❌ Error estadísticas edad:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Desglose por candidato: género y edad
app.get('/estadisticas-candidato', async (req, res) => {
    try {
        const { zona, candidato, dignidad } = req.query;
        const paramsG = [], paramsE = [], paramsT = [];

        let where = 'WHERE 1=1 AND dignidad != ?';
        paramsG.push('PREGUNTAS'); paramsE.push('PREGUNTAS'); paramsT.push('PREGUNTAS');
        if (dignidad && dignidad !== 'todas' && dignidad !== 'PREGUNTAS') {
            where += ' AND dignidad = ?';
            paramsG.push(dignidad); paramsE.push(dignidad); paramsT.push(dignidad);
        }
        if (zona && zona !== 'todas') {
            where += ' AND zona = ?';
            paramsG.push(zona); paramsE.push(zona); paramsT.push(zona);
        }
        if (candidato && candidato !== 'todos') {
            where += ' AND candidato = ?';
            paramsG.push(candidato); paramsE.push(candidato); paramsT.push(candidato);
        }

        const [genero] = await db.execute(
            `SELECT genero, COUNT(*) as total FROM votos ${where} AND genero IS NOT NULL GROUP BY genero ORDER BY total DESC`,
            paramsG
        );
        const [edad] = await db.execute(
            `SELECT rango_edad, COUNT(*) as total FROM votos ${where} AND rango_edad IS NOT NULL GROUP BY rango_edad ORDER BY FIELD(rango_edad, '18-25', '26-40', '+41')`,
            paramsE
        );
        const [instruccion] = await db.execute(
            `SELECT nivel_instruccion, COUNT(*) as total FROM votos ${where} AND nivel_instruccion IS NOT NULL GROUP BY nivel_instruccion ORDER BY total DESC`,
            [...paramsG]
        );
        const [ocupacion] = await db.execute(
            `SELECT ocupacion, COUNT(*) as total FROM votos ${where} AND ocupacion IS NOT NULL GROUP BY ocupacion ORDER BY total DESC`,
            [...paramsG]
        );
        const [totalRes] = await db.execute(
            `SELECT COUNT(*) as total FROM votos ${where}`,
            paramsT
        );

        res.json({ genero, edad, instruccion, ocupacion, total: totalRes[0].total });
    } catch (err) {
        console.error("❌ Error estadísticas candidato:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Estadísticas de preguntas: respuestas agrupadas por pregunta
app.get('/estadisticas-preguntas', async (req, res) => {
    try {
        const { zona } = req.query;
        const params = [];
        let where = 'WHERE 1=1';
        if (zona && zona !== 'todas') { where += ' AND v.zona = ?'; params.push(zona); }

        // Total de personas distintas que respondieron preguntas
        let sqlPersonas = 'SELECT COUNT(DISTINCT v.id) AS total FROM votos v WHERE v.dignidad = ?';
        const paramsPersonas = ['PREGUNTAS'];
        if (zona && zona !== 'todas') { sqlPersonas += ' AND v.zona = ?'; paramsPersonas.push(zona); }
        const [totalRows] = await db.execute(sqlPersonas, paramsPersonas);
        const totalPersonas = totalRows[0]?.total || 0;

        const [results] = await db.execute(`
            SELECT p.id, p.pregunta, p.orden,
                   SUM(CASE WHEN r.respuesta = 'muy_de_acuerdo' THEN 1 ELSE 0 END) AS muy_de_acuerdo,
                   SUM(CASE WHEN r.respuesta = 'de_acuerdo' THEN 1 ELSE 0 END) AS de_acuerdo,
                   SUM(CASE WHEN r.respuesta = 'indiferente' THEN 1 ELSE 0 END) AS indiferente,
                   SUM(CASE WHEN r.respuesta = 'en_desacuerdo' THEN 1 ELSE 0 END) AS en_desacuerdo,
                   SUM(CASE WHEN r.respuesta = 'totalmente_en_desacuerdo' THEN 1 ELSE 0 END) AS totalmente_en_desacuerdo,
                   COUNT(DISTINCT r.id_voto) AS personas
            FROM preguntas p
            LEFT JOIN respuestas r ON p.id = r.id_pregunta
            LEFT JOIN votos v ON r.id_voto = v.id
            ${where}
            GROUP BY p.id, p.pregunta, p.orden
            ORDER BY p.orden ASC, p.id ASC
        `, params);

        // Agregar desglose por género y edad para cada pregunta (sobre personas distintas)
        for (const p of results) {
            const [genero] = await db.execute(`
                SELECT v.genero, COUNT(DISTINCT v.id) AS total
                FROM respuestas r
                INNER JOIN votos v ON r.id_voto = v.id
                WHERE r.id_pregunta = ? ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''}
                GROUP BY v.genero
            `, zona && zona !== 'todas' ? [p.id, zona] : [p.id]);
            p.genero = genero;

            const [edad] = await db.execute(`
                SELECT v.rango_edad, COUNT(DISTINCT v.id) AS total
                FROM respuestas r
                INNER JOIN votos v ON r.id_voto = v.id
                WHERE r.id_pregunta = ? ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''}
                GROUP BY v.rango_edad
            `, zona && zona !== 'todas' ? [p.id, zona] : [p.id]);
            p.edad = edad;

            const [instruccion] = await db.execute(`
                SELECT v.nivel_instruccion, COUNT(DISTINCT v.id) AS total
                FROM respuestas r
                INNER JOIN votos v ON r.id_voto = v.id
                WHERE r.id_pregunta = ? ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''} AND v.nivel_instruccion IS NOT NULL
                GROUP BY v.nivel_instruccion
            `, zona && zona !== 'todas' ? [p.id, zona] : [p.id]);
            p.instruccion = instruccion;

            const [ocupacion] = await db.execute(`
                SELECT v.ocupacion, COUNT(DISTINCT v.id) AS total
                FROM respuestas r
                INNER JOIN votos v ON r.id_voto = v.id
                WHERE r.id_pregunta = ? ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''} AND v.ocupacion IS NOT NULL
                GROUP BY v.ocupacion
            `, zona && zona !== 'todas' ? [p.id, zona] : [p.id]);
            p.ocupacion = ocupacion;
        }

        // Estadísticas de problema principal y medio de información
        const [problemas] = await db.execute(
            `SELECT v.problema_principal, COUNT(DISTINCT v.id) AS total FROM votos v WHERE v.dignidad = ? AND v.problema_principal IS NOT NULL ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''} GROUP BY v.problema_principal ORDER BY total DESC`,
            zona && zona !== 'todas' ? ['PREGUNTAS', zona] : ['PREGUNTAS']
        );
        const [medios] = await db.execute(
            `SELECT v.medio_informacion, COUNT(DISTINCT v.id) AS total FROM votos v WHERE v.dignidad = ? AND v.medio_informacion IS NOT NULL ${zona && zona !== 'todas' ? 'AND v.zona = ?' : ''} GROUP BY v.medio_informacion ORDER BY total DESC`,
            zona && zona !== 'todas' ? ['PREGUNTAS', zona] : ['PREGUNTAS']
        );

        res.json({ success: true, preguntas: results, total_personas: totalPersonas, problemas, medios });
    } catch (err) {
        console.error("❌ Error estadísticas preguntas:", err.message);
        res.status(500).json({ success: false, message: 'Error al obtener estadísticas de preguntas' });
    }
});

/* GET /analisis-resultados — análisis de dominancia demográfica para votaciones */
app.get('/analisis-resultados', autenticarSesion, async (req, res) => {
    try {
        const { dignidad, zona } = req.query;
        const buildWhere = (extra = '') => {
            let w = 'WHERE 1=1 AND dignidad != ?';
            const p = ['PREGUNTAS'];
            if (dignidad && dignidad !== 'todas' && dignidad !== 'PREGUNTAS') { w += ' AND dignidad = ?'; p.push(dignidad); }
            if (zona && zona !== 'todas') { w += ' AND zona = ?'; p.push(zona); }
            if (extra) w += extra;
            return { where: w, params: p };
        };

        // Total general
        const { where: w1, params: p1 } = buildWhere();
        const [totalRows] = await db.execute(`SELECT COUNT(*) as total FROM votos ${w1}`, p1);
        const totalVotos = totalRows[0]?.total || 0;

        // Votos por candidato
        const [candidatos] = await db.execute(`SELECT candidato, COUNT(*) as total FROM votos ${w1} GROUP BY candidato ORDER BY total DESC`, p1);
        const lider = candidatos[0]?.candidato || '—';

        // Dominancia por género
        const { where: wg, params: pg } = buildWhere(' AND genero IS NOT NULL');
        const [generoDominio] = await db.execute(`SELECT genero, candidato, COUNT(*) as total FROM votos ${wg} GROUP BY genero, candidato ORDER BY genero, total DESC`, pg);

        // Dominancia por edad
        const { where: we, params: pe } = buildWhere(' AND rango_edad IS NOT NULL');
        const [edadDominio] = await db.execute(`SELECT rango_edad, candidato, COUNT(*) as total FROM votos ${we} GROUP BY rango_edad, candidato ORDER BY rango_edad, total DESC`, pe);

        // Dominancia por instrucción
        const { where: wi, params: pi } = buildWhere(' AND nivel_instruccion IS NOT NULL');
        const [instruccionDominio] = await db.execute(`SELECT nivel_instruccion, candidato, COUNT(*) as total FROM votos ${wi} GROUP BY nivel_instruccion, candidato ORDER BY nivel_instruccion, total DESC`, pi);

        // Dominancia por ocupación
        const { where: wo, params: po } = buildWhere(' AND ocupacion IS NOT NULL');
        const [ocupacionDominio] = await db.execute(`SELECT ocupacion, candidato, COUNT(*) as total FROM votos ${wo} GROUP BY ocupacion, candidato ORDER BY ocupacion, total DESC`, po);

        // Dominancia por zona
        const { where: wz, params: pz } = buildWhere(' AND zona IS NOT NULL');
        const [zonaDominio] = await db.execute(`SELECT zona, candidato, COUNT(*) as total FROM votos ${wz} GROUP BY zona, candidato ORDER BY zona, total DESC`, pz);

        // Votos por dignidad (general)
        const { where: wd, params: pd } = buildWhere();
        const [dignidadRes] = await db.execute(`SELECT dignidad, COUNT(*) as total FROM votos ${wd} GROUP BY dignidad ORDER BY total DESC`, pd);

        // Perfil de cada candidato
        const candidatoProfiles = {};
        for (const c of candidatos) {
            const nom = c.candidato;
            // género
            const { where: wcg, params: pcg } = buildWhere(' AND candidato = ? AND genero IS NOT NULL');
            pcg.push(nom);
            const [cg] = await db.execute(`SELECT genero, COUNT(*) as total FROM votos ${wcg} GROUP BY genero ORDER BY total DESC`, pcg);
            // edad
            const { where: wce, params: pce } = buildWhere(' AND candidato = ? AND rango_edad IS NOT NULL');
            pce.push(nom);
            const [ce] = await db.execute(`SELECT rango_edad, COUNT(*) as total FROM votos ${wce} GROUP BY rango_edad ORDER BY FIELD(rango_edad, '18-25','26-40','+41')`, pce);
            // instrucción
            const { where: wci, params: pci } = buildWhere(' AND candidato = ? AND nivel_instruccion IS NOT NULL');
            pci.push(nom);
            const [ci] = await db.execute(`SELECT nivel_instruccion, COUNT(*) as total FROM votos ${wci} GROUP BY nivel_instruccion ORDER BY total DESC`, pci);
            // ocupación
            const { where: wco, params: pco } = buildWhere(' AND candidato = ? AND ocupacion IS NOT NULL');
            pco.push(nom);
            const [co] = await db.execute(`SELECT ocupacion, COUNT(*) as total FROM votos ${wco} GROUP BY ocupacion ORDER BY total DESC`, pco);
            candidatoProfiles[nom] = { genero: cg, edad: ce, instruccion: ci, ocupacion: co, total: c.total };
        }

        res.json({
            success: true,
            total_votos: totalVotos,
            lider,
            candidatos,
            dignidad_res: dignidadRes,
            dominancia: {
                genero: generoDominio,
                edad: edadDominio,
                instruccion: instruccionDominio,
                ocupacion: ocupacionDominio,
                zona: zonaDominio
            },
            candidato_perfiles: candidatoProfiles
        });
    } catch (err) {
        console.error('❌ Error analisis-resultados:', err.message);
        res.status(500).json({ success: false, message: 'Error al obtener análisis de resultados' });
    }
});

// Lista de candidatos disponibles
app.get('/candidatos-disponibles', async (req, res) => {
    try {
        const { dignidad } = req.query;
        const params = [];
        let sql = 'SELECT DISTINCT candidato FROM votos WHERE 1=1';
        if (dignidad && dignidad !== 'todas') { sql += ' AND dignidad = ?'; params.push(dignidad); }
        sql += ' ORDER BY candidato ASC';
        const [results] = await db.execute(sql, params);
        res.json(results);
    } catch (err) {
        console.error("❌ Error candidatos:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Zonas disponibles
app.get('/zonas-disponibles', async (req, res) => {
    try {
        const { dignidad } = req.query;
        const params = [];
        let sql = 'SELECT DISTINCT zona FROM votos WHERE 1=1';
        if (dignidad && dignidad !== 'todas') { sql += ' AND dignidad = ?'; params.push(dignidad); }
        sql += ' ORDER BY zona ASC';
        const [results] = await db.execute(sql, params);
        res.json(results);
    } catch (err) {
        console.error("❌ Error zonas:", err.message);
        res.status(500).json({ error: "Error" });
    }
});

// Descargar Excel
app.get('/descargar-excel', async (req, res) => {
    try {
        // Verificar si la ubicación está habilitada
        const [configRows] = await db.query(
            "SELECT valor FROM sistema_config WHERE clave = 'permitir_ubicacion' LIMIT 1"
        );
        const ubicacionHabilitada = configRows.length > 0 && configRows[0].valor === '1';

        const selectFields = `
                v.dignidad,
                v.candidato,
                v.zona,
                v.rango_edad,
                v.genero,
                v.nivel_instruccion,
                v.ocupacion,
                v.problema_principal,
                v.medio_informacion,
                u.usuario       AS encuestador,
                u.cedula        AS cedula_encuestador,
                DATE_FORMAT(v.fecha_voto, '%d/%m/%Y') AS fecha,
                DATE_FORMAT(v.fecha_voto, '%H:%i:%s') AS hora
                ${ubicacionHabilitada ? ', v.latitud, v.longitud' : ''}
        `;

        const [rows] = await db.query(`
            SELECT ${selectFields}
            FROM votos v
            INNER JOIN usuarios u ON v.id_encuestador = u.id
            ORDER BY v.fecha_voto DESC
        `);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "No hay votos registrados para exportar." });
        }

        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Reporte Sucúa 2026');

        const baseColumns = [
            { header: 'Dignidad',           key: 'dignidad',           width: 18 },
            { header: 'Candidato',          key: 'candidato',          width: 22 },
            { header: 'Zona / Barrio',      key: 'zona',               width: 28 },
            { header: 'Rango de Edad',      key: 'rango_edad',         width: 16 },
            { header: 'Género',             key: 'genero',             width: 12 },
            { header: 'Nivel Instrucción',  key: 'nivel_instruccion',  width: 18 },
            { header: 'Ocupación',          key: 'ocupacion',          width: 20 },
            { header: 'Problema Principal', key: 'problema_principal', width: 20 },
            { header: 'Medio Información',  key: 'medio_informacion',  width: 20 },
            { header: 'Encuestador',        key: 'encuestador',        width: 20 },
            { header: 'Cédula',             key: 'cedula_encuestador', width: 14 },
            { header: 'Fecha',              key: 'fecha',              width: 14 },
            { header: 'Hora',               key: 'hora',               width: 12 }
        ];

        const ubicacionColumns = [
            { header: 'Latitud',      key: 'latitud',            width: 14 },
            { header: 'Longitud',     key: 'longitud',           width: 14 }
        ];

        worksheet.columns = ubicacionHabilitada
            ? [...baseColumns, ...ubicacionColumns]
            : baseColumns;

        const headerRow = worksheet.getRow(1);
        headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00A884' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height    = 22;

        worksheet.addRows(rows);

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: rowNumber % 2 === 0 ? 'FFF0FDF4' : 'FFFFFFFF' }
                };
            }
            row.alignment = { vertical: 'middle' };
        });

        const totalRowData = {
            candidato: `TOTAL DE VOTOS: ${rows.length}`,
            zona: '', rango_edad: '', genero: '', encuestador: '', cedula_encuestador: '', fecha: '', hora: ''
        };
        if (ubicacionHabilitada) {
            totalRowData.latitud = '';
            totalRowData.longitud = '';
        }
        const totalRow = worksheet.addRow(totalRowData);
        totalRow.font = { bold: true, color: { argb: 'FF064E3B' } };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };

        const fecha = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_Sucua_${fecha}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
        console.log(`✅ Excel generado: ${rows.length} votos`);

    } catch (err) {
        console.error("❌ Error Excel:", err.message);
        res.status(500).json({ error: "Error al generar el reporte", detalle: err.message });
    }
});

// Descargar Excel - solo dignidades (sin PREGUNTAS)
app.get('/descargar-excel-dignidades', async (req, res) => {
    try {
        const [configRows] = await db.query("SELECT valor FROM sistema_config WHERE clave = 'permitir_ubicacion' LIMIT 1");
        const ubicacionHabilitada = configRows.length > 0 && configRows[0].valor === '1';

        const selectFields = `
                v.dignidad,
                v.candidato,
                v.zona,
                v.rango_edad,
                v.genero,
                v.nivel_instruccion,
                v.ocupacion,
                v.problema_principal,
                v.medio_informacion,
                u.usuario       AS encuestador,
                u.cedula        AS cedula_encuestador,
                DATE_FORMAT(v.fecha_voto, '%d/%m/%Y') AS fecha,
                DATE_FORMAT(v.fecha_voto, '%H:%i:%s') AS hora
                ${ubicacionHabilitada ? ', v.latitud, v.longitud' : ''}
        `;

        const [rows] = await db.query(`
            SELECT ${selectFields}
            FROM votos v
            INNER JOIN usuarios u ON v.id_encuestador = u.id
            WHERE v.dignidad != 'PREGUNTAS'
            ORDER BY v.fecha_voto DESC
        `);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "No hay votos de dignidades registrados para exportar." });
        }

        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Votos Dignidades');

        const baseColumns = [
            { header: 'Dignidad',           key: 'dignidad',           width: 18 },
            { header: 'Candidato',          key: 'candidato',          width: 22 },
            { header: 'Zona / Barrio',      key: 'zona',               width: 28 },
            { header: 'Rango de Edad',      key: 'rango_edad',         width: 16 },
            { header: 'Género',             key: 'genero',             width: 12 },
            { header: 'Nivel Instrucción',  key: 'nivel_instruccion',  width: 18 },
            { header: 'Ocupación',          key: 'ocupacion',          width: 20 },
            { header: 'Problema Principal', key: 'problema_principal', width: 20 },
            { header: 'Medio Información',  key: 'medio_informacion',  width: 20 },
            { header: 'Encuestador',        key: 'encuestador',        width: 20 },
            { header: 'Cédula',             key: 'cedula_encuestador', width: 14 },
            { header: 'Fecha',              key: 'fecha',              width: 14 },
            { header: 'Hora',               key: 'hora',               width: 12 }
        ];

        const ubicacionColumns = [
            { header: 'Latitud',      key: 'latitud',            width: 14 },
            { header: 'Longitud',     key: 'longitud',           width: 14 }
        ];

        worksheet.columns = ubicacionHabilitada
            ? [...baseColumns, ...ubicacionColumns]
            : baseColumns;

        const headerRow = worksheet.getRow(1);
        headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00A884' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height    = 22;

        worksheet.addRows(rows);

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: rowNumber % 2 === 0 ? 'FFF0FDF4' : 'FFFFFFFF' }
                };
            }
            row.alignment = { vertical: 'middle' };
        });

        const totalRowData = {
            candidato: `TOTAL DE VOTOS: ${rows.length}`,
            zona: '', rango_edad: '', genero: '', encuestador: '', cedula_encuestador: '', fecha: '', hora: ''
        };
        if (ubicacionHabilitada) {
            totalRowData.latitud = '';
            totalRowData.longitud = '';
        }
        const totalRow = worksheet.addRow(totalRowData);
        totalRow.font = { bold: true, color: { argb: 'FF064E3B' } };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };

        const fecha = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Votos_Dignidades_${fecha}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
        console.log(`✅ Excel dignidades generado: ${rows.length} votos`);

    } catch (err) {
        console.error("❌ Error Excel dignidades:", err.message);
        res.status(500).json({ error: "Error al generar el reporte", detalle: err.message });
    }
});

// Descargar Excel - solo preguntas (respuestas)
app.get('/descargar-excel-preguntas', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.pregunta,
                   r.respuesta,
                   v.zona,
                   v.rango_edad,
                   v.genero,
                   v.nivel_instruccion,
                   v.ocupacion,
                   v.problema_principal,
                   v.medio_informacion,
                   u.usuario       AS encuestador,
                   u.cedula        AS cedula_encuestador,
                   DATE_FORMAT(v.fecha_voto, '%d/%m/%Y') AS fecha,
                   DATE_FORMAT(v.fecha_voto, '%H:%i:%s') AS hora
            FROM respuestas r
            INNER JOIN votos v ON r.id_voto = v.id
            INNER JOIN usuarios u ON v.id_encuestador = u.id
            INNER JOIN preguntas p ON r.id_pregunta = p.id
            ORDER BY v.fecha_voto DESC
        `);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "No hay respuestas a preguntas registradas para exportar." });
        }

        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Respuestas Preguntas');

        worksheet.columns = [
            { header: 'Pregunta',           key: 'pregunta',           width: 50 },
            { header: 'Respuesta',          key: 'respuesta',          width: 25 },
            { header: 'Zona / Barrio',      key: 'zona',               width: 28 },
            { header: 'Rango de Edad',      key: 'rango_edad',         width: 16 },
            { header: 'Género',             key: 'genero',             width: 12 },
            { header: 'Nivel Instrucción',  key: 'nivel_instruccion',  width: 18 },
            { header: 'Ocupación',          key: 'ocupacion',          width: 20 },
            { header: 'Problema Principal', key: 'problema_principal', width: 20 },
            { header: 'Medio Información',  key: 'medio_informacion',  width: 20 },
            { header: 'Encuestador',        key: 'encuestador',        width: 20 },
            { header: 'Cédula',             key: 'cedula_encuestador', width: 14 },
            { header: 'Fecha',              key: 'fecha',              width: 14 },
            { header: 'Hora',               key: 'hora',               width: 12 }
        ];

        const headerRow = worksheet.getRow(1);
        headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height    = 22;

        worksheet.addRows(rows);

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: rowNumber % 2 === 0 ? 'FFEFF6FF' : 'FFFFFFFF' }
                };
            }
            row.alignment = { vertical: 'middle' };
        });

        const totalRow = worksheet.addRow({ pregunta: `TOTAL DE RESPUESTAS: ${rows.length}` });
        totalRow.font = { bold: true, color: { argb: 'FF1E3A5F' } };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

        const fecha = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Respuestas_Preguntas_${fecha}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
        console.log(`✅ Excel preguntas generado: ${rows.length} respuestas`);

    } catch (err) {
        console.error("❌ Error Excel preguntas:", err.message);
        res.status(500).json({ error: "Error al generar el reporte", detalle: err.message });
    }
});

// Estado de bloqueo de acceso (público para login y apps)
app.get('/estado-acceso', async (req, res) => {
    try {
        const bloqueado = await estaAccesoBloqueado();
        res.json({ success: true, bloqueado });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al consultar estado' });
    }
});

/* Bloquear / desbloquear acceso de admin y encuestadores (solo superadmin) */
app.post('/bloqueo-acceso', autenticarSesion, requiereRol('superadmin'), validarBooleano, async (req, res) => {
    const { bloquear } = req.body;
    try {
        await setAccesoBloqueado(bloquear);
        console.log(bloquear ? '🔒 Acceso bloqueado (admin/encuestadores)' : '🔓 Acceso desbloqueado');
        res.json({
            success: true,
            bloqueado: bloquear,
            message: bloquear
                ? 'Acceso bloqueado para administradores y encuestadores.'
                : 'Acceso habilitado para todos los usuarios.'
        });
    } catch (err) {
        console.error('❌ Error bloqueo acceso:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar el bloqueo' });
    }
});

// ====== Ubicación de votos ======

/* Obtener ubicaciones de votos con candidato */
app.get('/ubicacion-votos', autenticarSesion, async (req, res) => {
    try {
        const { dignidad, candidato } = req.query;
        let sql = `SELECT v.latitud, v.longitud, v.candidato, v.dignidad, v.zona,
                          v.fecha_voto, u.usuario AS encuestador
                   FROM votos v
                   LEFT JOIN usuarios u ON v.id_encuestador = u.id
                   WHERE v.latitud IS NOT NULL AND v.longitud IS NOT NULL`;
        const params = [];
        if (dignidad && dignidad !== 'todas') { sql += ' AND v.dignidad = ?'; params.push(dignidad); }
        if (candidato && candidato !== 'todos') { sql += ' AND v.candidato = ?'; params.push(candidato); }
        sql += ' ORDER BY v.fecha_voto DESC';
        const [rows] = await db.execute(sql, params);
        res.json({ success: true, ubicaciones: rows });
    } catch (err) {
        console.error('❌ Error ubicacion-votos:', err.message, err.sqlMessage || '');
        res.status(500).json({ success: false, message: 'Error al obtener ubicaciones' });
    }
});

/* Estado de config ubicación */
app.get('/config-ubicacion', autenticarSesion, async (req, res) => {
    try {
        const permitido = await estaUbicacionPermitida();
        res.json({ success: true, permitir_ubicacion: permitido });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al consultar config' });
    }
});

/* Cambiar config ubicación (solo superadmin) */
app.post('/config-ubicacion', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    const { permitir_ubicacion } = req.body;
    const nuevoValor = !!permitir_ubicacion;
    try {
        await setUbicacionPermitida(nuevoValor);
        console.log(nuevoValor ? '📍 Ubicación habilitada' : '📍 Ubicación deshabilitada');
        res.json({
            success: true,
            permitir_ubicacion: nuevoValor,
            message: nuevoValor
                ? 'Captura de ubicación habilitada para los encuestadores.'
                : 'Captura de ubicación deshabilitada.'
        });
    } catch (err) {
        console.error('❌ Error config-ubicacion:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la configuración' });
    }
});

/* Estado config mostrar_respuestas (admin) */
async function estaMostrarRespuestas() {
    try {
        const [rows] = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'mostrar_respuestas' LIMIT 1"
        );
        if (!rows.length) {
            await db.execute("INSERT INTO sistema_config (clave, valor) VALUES ('mostrar_respuestas', '1')");
            return true;
        }
        return rows[0].valor === '1';
    } catch (err) {
        console.error('❌ Error leyendo mostrar_respuestas:', err.message);
        return true;
    }
}

async function setMostrarRespuestas(mostrar) {
    await db.execute(
        `INSERT INTO sistema_config (clave, valor) VALUES ('mostrar_respuestas', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [mostrar ? '1' : '0']
    );
}

app.get('/config-respuestas', autenticarSesion, async (req, res) => {
    try {
        const mostrar = await estaMostrarRespuestas();
        res.json({ success: true, mostrar_respuestas: mostrar });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al consultar config' });
    }
});

app.post('/config-respuestas', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    const { mostrar_respuestas } = req.body;
    const nuevoValor = !!mostrar_respuestas;
    try {
        await setMostrarRespuestas(nuevoValor);
        console.log(nuevoValor ? '📊 Respuestas habilitadas en admin' : '📊 Respuestas deshabilitadas en admin');
        res.json({
            success: true,
            mostrar_respuestas: nuevoValor,
            message: nuevoValor
                ? 'Sección Respuestas visible en el panel.'
                : 'Sección Respuestas oculta en el panel.'
        });
    } catch (err) {
        console.error('❌ Error config-respuestas:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar la configuración' });
    }
});

// ============ PREGUNTAS CRUD ============

/* GET /preguntas — listar preguntas (opcional ?activas=1) */
app.get('/preguntas', autenticarSesion, async (req, res) => {
    try {
        let sql = 'SELECT * FROM preguntas';
        const params = [];
        if (req.query.activas === '1') {
            sql += ' WHERE activa = 1';
        }
        sql += ' ORDER BY orden ASC, id ASC';
        const [rows] = await db.execute(sql, params);
        res.json({ success: true, preguntas: rows });
    } catch (err) {
        console.error('❌ Error listando preguntas:', err.message);
        res.status(500).json({ success: false, message: 'Error al listar preguntas' });
    }
});

/* POST /preguntas — crear pregunta */
app.post('/preguntas', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    try {
        const { pregunta, activa, orden } = req.body;
        if (!pregunta || typeof pregunta !== 'string' || pregunta.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'La pregunta es requerida' });
        }
        const [result] = await db.execute(
            'INSERT INTO preguntas (pregunta, activa, orden) VALUES (?, ?, ?)',
            [pregunta.trim(), activa !== false ? 1 : 0, orden || 0]
        );
        res.json({ success: true, id: result.insertId, message: 'Pregunta creada correctamente' });
    } catch (err) {
        console.error('❌ Error creando pregunta:', err.message);
        res.status(500).json({ success: false, message: 'Error al crear pregunta' });
    }
});

/* PUT /preguntas/:id — actualizar pregunta */
app.put('/preguntas/:id', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { pregunta, activa, orden } = req.body;
        if (!pregunta || typeof pregunta !== 'string' || pregunta.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'La pregunta es requerida' });
        }
        await db.execute(
            'UPDATE preguntas SET pregunta = ?, activa = ?, orden = ? WHERE id = ?',
            [pregunta.trim(), activa !== false ? 1 : 0, orden || 0, id]
        );
        res.json({ success: true, message: 'Pregunta actualizada correctamente' });
    } catch (err) {
        console.error('❌ Error actualizando pregunta:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar pregunta' });
    }
});

/* DELETE /preguntas/:id — eliminar pregunta */
app.delete('/preguntas/:id', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.execute('DELETE FROM preguntas WHERE id = ?', [id]);
        res.json({ success: true, message: 'Pregunta eliminada correctamente' });
    } catch (err) {
        console.error('❌ Error eliminando pregunta:', err.message);
        res.status(500).json({ success: false, message: 'Error al eliminar pregunta' });
    }
});

/* POST /votar-preguntas — registrar respuestas a preguntas */
app.post('/votar-preguntas', voteLimiter, async (req, res) => {
    try {
        const { zona, rango_edad, genero, respuestas, latitud, longitud, nivel_instruccion, ocupacion, problema_principal, medio_informacion } = req.body;
        const idEncuestador = req.auth?.user?.id;
        if (!idEncuestador) {
            return res.status(401).json({ success: false, message: 'Sesión requerida' });
        }
        if (!zona || !rango_edad || !genero || !Array.isArray(respuestas) || respuestas.length === 0) {
            return res.status(400).json({ success: false, message: 'Faltan datos requeridos' });
        }
        if (await estaAccesoBloqueado()) {
            return res.status(403).json({ success: false, codigo: 'ACCESO_BLOQUEADO', message: 'El sistema está bloqueado.' });
        }

        const permitirUb = await estaUbicacionPermitida();
        let lat = null, lng = null;
        if (permitirUb && latitud != null && longitud != null) {
            lat = parseFloat(latitud);
            lng = parseFloat(longitud);
            if (isNaN(lat)) lat = null;
            if (isNaN(lng)) lng = null;
        }

        // Crear voto principal con dignidad PREGUNTAS
        const [votoResult] = await db.execute(
            'INSERT INTO votos (dignidad, zona, rango_edad, candidato, id_encuestador, genero, nivel_instruccion, ocupacion, problema_principal, medio_informacion, fecha_voto, latitud, longitud) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
            ['PREGUNTAS', zona, rango_edad, 'PREGUNTAS', idEncuestador, genero, nivel_instruccion || null, ocupacion || null, problema_principal || null, medio_informacion || null, lat, lng]
        );
        const idVoto = votoResult.insertId;

        // Insertar todas las respuestas en un solo INSERT batch
        const validValues = [];
        const validRespuestas = ['muy_de_acuerdo', 'de_acuerdo', 'indiferente', 'en_desacuerdo', 'totalmente_en_desacuerdo'];
        for (const r of respuestas) {
            if (!validRespuestas.includes(r.respuesta)) continue;
            validValues.push(idVoto, r.id_pregunta, r.respuesta);
        }
        if (validValues.length > 0) {
            const placeholders = [];
            for (let i = 0; i < validValues.length; i += 3) {
                placeholders.push('(?, ?, ?)');
            }
            await db.execute(
                `INSERT INTO respuestas (id_voto, id_pregunta, respuesta) VALUES ${placeholders.join(', ')}`,
                validValues
            );
        }

        console.log(`📝 Voto PREGUNTAS ID: ${idVoto} | ${respuestas.length} respuestas`);
        res.json({ success: true, votoId: idVoto });
    } catch (err) {
        console.error('❌ Error voto-preguntas:', err.message);
        res.status(500).json({ success: false, message: 'Error al registrar respuestas' });
    }
});

// Reiniciar votos (solo superadmin) — nueva encuesta desde cero
app.post('/reiniciar-encuesta', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    try {
        await db.execute('DELETE FROM respuestas');
        const [result] = await db.execute('DELETE FROM votos');
        const eliminados = isPostgres ? result.rowCount : result.affectedRows;
        if (isPostgres) {
            await db.execute("ALTER SEQUENCE votos_id_seq RESTART WITH 1");
        } else {
            await db.execute('ALTER TABLE votos AUTO_INCREMENT = 1');
        }
        console.log(`🔄 Encuesta reiniciada: ${eliminados} votos eliminados, id_voto desde 1`);
        res.json({
            success: true,
            message: 'Todos los votos fueron eliminados y el contador id_voto reinició desde 1.',
            eliminados
        });
    } catch (err) {
        console.error('❌ Error reiniciando encuesta:', err.message);
        res.status(500).json({ success: false, message: 'Error al reiniciar los votos' });
    }
});

// Listar usuarios
app.get('/usuarios', async (req, res) => {
    const rolSolicitante = req.auth?.user?.rol || '';
    try {
        const sql = rolSolicitante === 'superadmin'
            ? 'SELECT id, cedula, usuario, rol, fecha_creacion FROM usuarios ORDER BY fecha_creacion DESC'
            : "SELECT id, cedula, usuario, rol, fecha_creacion FROM usuarios WHERE rol != 'superadmin' ORDER BY fecha_creacion DESC";
        const [rows] = await db.execute(sql);
        res.json({ success: true, usuarios: rows });
    } catch (err) {
        console.error("❌ Error listando usuarios:", err.message);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Eliminar usuario
app.delete('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const idSesion = String(req.auth?.user?.id || '');
    const rolAdmin = req.auth?.user?.rol || '';
    try {
        const [rows] = await db.execute('SELECT usuario, rol FROM usuarios WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        if (rows[0].rol === 'superadmin') {
            return res.status(403).json({
                success: false,
                message: 'No se puede eliminar la cuenta de superadministrador'
            });
        }
        if (String(id) === idSesion) {
            return res.status(403).json({
                success: false,
                message: 'No puedes eliminar tu propia cuenta desde esta sesión'
            });
        }
        if (!['admin', 'superadmin'].includes(rolAdmin)) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para eliminar usuarios' });
        }
        await db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
        console.log(`🗑️ Usuario eliminado ID: ${id} (${rows[0].usuario})`);
        res.json({ success: true, message: `Usuario "${rows[0].usuario}" eliminado` });
    } catch (err) {
        console.error("❌ Error eliminando usuario:", err.message);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// ============ CANDIDATOS CRUD ============

// Listar candidatos por dignidad (y opcionalmente zona)
app.get('/candidatos', autenticarSesion, async (req, res) => {
    try {
        const { dignidad, zona } = req.query;
        let sql = 'SELECT id, dignidad, nombre, foto, zona, orden FROM candidatos WHERE 1=1';
        const params = [];
        if (dignidad && dignidad !== 'todas') { sql += ' AND dignidad = ?'; params.push(dignidad); }
        if (zona) { sql += ' AND (zona IS NULL OR zona = ?)'; params.push(zona); }
        sql += ' ORDER BY orden ASC, id ASC';
        const [rows] = await db.execute(sql, params);
        res.json({ success: true, candidatos: rows });
    } catch (err) {
        console.error('❌ Error listando candidatos:', err.message);
        res.status(500).json({ success: false, message: 'Error al listar candidatos' });
    }
});

// Crear candidato (superadmin)
app.post('/candidatos', autenticarSesion, requiereRol('superadmin'), upload.single('foto'), async (req, res) => {
    try {
        const { dignidad, nombre, zona, orden } = req.body;
        if (!dignidad || !nombre) {
            return res.status(400).json({ success: false, message: 'Dignidad y nombre requeridos' });
        }
        const foto = req.file ? req.file.filename : 'placeholder-candidato.svg';
        const [result] = await db.execute(
            'INSERT INTO candidatos (dignidad, nombre, foto, zona, orden) VALUES (?, ?, ?, ?, ?)',
            [dignidad, nombre, foto, zona || null, parseInt(orden) || 0]
        );
        res.json({ success: true, id: result.insertId, foto, message: 'Candidato creado' });
    } catch (err) {
        console.error('❌ Error creando candidato:', err.message);
        res.status(500).json({ success: false, message: 'Error al crear candidato' });
    }
});

// Actualizar candidato (superadmin)
app.put('/candidatos/:id', autenticarSesion, requiereRol('superadmin'), upload.single('foto'), async (req, res) => {
    try {
        const { id } = req.params;
        const { dignidad, nombre, zona, orden } = req.body;
        const [existing] = await db.execute('SELECT foto FROM candidatos WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Candidato no encontrado' });
        }
        const foto = req.file ? req.file.filename : existing[0].foto;
        await db.execute(
            'UPDATE candidatos SET dignidad = ?, nombre = ?, foto = ?, zona = ?, orden = ? WHERE id = ?',
            [dignidad || 'ALCALDE', nombre, foto, zona || null, parseInt(orden) || 0, id]
        );
        res.json({ success: true, message: 'Candidato actualizado' });
    } catch (err) {
        console.error('❌ Error actualizando candidato:', err.message);
        res.status(500).json({ success: false, message: 'Error al actualizar candidato' });
    }
});

// Eliminar candidato (superadmin)
app.delete('/candidatos/:id', autenticarSesion, requiereRol('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const [existing] = await db.execute('SELECT foto FROM candidatos WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Candidato no encontrado' });
        }
        await db.execute('DELETE FROM candidatos WHERE id = ?', [id]);
        res.json({ success: true, message: 'Candidato eliminado' });
    } catch (err) {
        console.error('❌ Error eliminando candidato:', err.message);
        res.status(500).json({ success: false, message: 'Error al eliminar candidato' });
    }
});

// Subir foto sin crear candidato (útil para reemplazar)
app.post('/candidatos/subir-foto', autenticarSesion, requiereRol('superadmin'), upload.single('foto'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Archivo requerido' });
    }
    res.json({ success: true, foto: req.file.filename, message: 'Foto subida' });
});

// Health
app.get('/debug', (req, res) => {
    res.json({ status: '✅ Online', timestamp: new Date().toISOString(), uptime: process.uptime() });
});
app.get('/health', (req, res) => { res.json({ status: 'ok' }); });

// 404
app.use((req, res) => { res.status(404).json({ message: "No encontrado" }); });

// Error general
app.use((err, req, res, next) => {
    console.error("Error:", err);
    res.status(500).json({ message: "Error interno del servidor" });
});

const PORT = process.env.PORT || 3020;
app.listen(PORT, () => { console.log(`🚀 Servidor en puerto ${PORT}`); });
