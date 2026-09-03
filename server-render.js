/**
 * server.js - Backend Sistema de Encuestas Sucúa 2026
 * Compatible con MySQL (local) y PostgreSQL (Render)
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
app.use('/encuesta', express.static(publicPath, {
    maxAge: '0',
    etag: false
}));

// Servir fotos de candidatos
app.use('/encuesta/assets/candidatos', express.static(path.join(publicPath, 'assets', 'candidatos'), {
    maxAge: '7d'
}));

// Proxy de tiles OpenStreetMap
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
// Soporte para PostgreSQL (Render) y MySQL (local)
let db;
let pool;

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
    // PostgreSQL para Render
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    db = {
        execute: async (query, params = []) => {
            // Convertir ? a $1, $2, etc. para PostgreSQL
            let pgQuery = query;
            let paramIndex = 1;
            pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
            return pool.query(pgQuery, params);
        },
        query: async (query, params = []) => {
            let pgQuery = query;
            let paramIndex = 1;
            pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
            return pool.query(pgQuery, params);
        }
    };
    console.log('✅ Conectado a PostgreSQL (Render)');
} else {
    // MySQL para local
    const mysql = require('mysql2');
    pool = mysql.createPool({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'Betoben1',
        database: process.env.DB_NAME     || 'encuesta_sucua_bd',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    db = pool.promise();
    console.log('✅ Conectado a MySQL (local)');
}

// ============ 5. INICIALIZACIÓN ============
async function initSistemaConfig() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sistema_config (
                clave VARCHAR(64) PRIMARY KEY,
                valor VARCHAR(255) NOT NULL DEFAULT '0'
            )
        `);
        const result = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado'"
        );
        const rows = result.rows || result[0] || [];
        if (rows.length === 0) {
            await db.execute(
                "INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0')"
            );
        }
    } catch (err) {
        console.error('❌ Error init sistema_config:', err.message);
    }
}

async function estaAccesoBloqueado() {
    try {
        const result = await db.execute(
            "SELECT valor FROM sistema_config WHERE clave = 'acceso_bloqueado' LIMIT 1"
        );
        const rows = result.rows || result[0] || [];
        return rows.length > 0 && rows[0].valor === '1';
    } catch (err) {
        console.error('❌ Error leyendo acceso_bloqueado:', err.message);
        return false;
    }
}

async function setAccesoBloqueado(bloquear) {
    if (DATABASE_URL) {
        await db.execute(
            `INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', $1)
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
            [bloquear ? '1' : '0']
        );
    } else {
        await db.execute(
            `INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', ?)
             ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
            [bloquear ? '1' : '0']
        );
    }
}

// ============ 6. AUTENTICACIÓN ============
const sesiones = new Map();

function autenticarSesion(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !sesiones.has(token)) {
        return res.status(401).json({ error: 'Sesión no válida' });
    }
    req.usuario = sesiones.get(token);
    next();
}

function requiereRol(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.usuario?.rol)) {
            return res.status(403).json({ error: 'Acceso no autorizado' });
        }
        next();
    };
}

// ============ 7. RUTAS ============

function verificarPassword(plain, stored) {
    if (!stored.startsWith('pbkdf2$')) return plain === stored;
    const partes = stored.split('$');
    if (partes.length !== 3) return false;
    const salt = partes[1];
    const hashGuardado = partes[2];
    const hashCalculado = crypto.pbkdf2Sync(plain, salt, 120000, 64, 'sha512').toString('hex');
    if (hashGuardado.length !== hashCalculado.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hashGuardado, 'hex'), Buffer.from(hashCalculado, 'hex'));
}

// Login
app.post('/login', loginLimiter, async (req, res) => {
    try {
        const { usuario, password } = req.body;
        console.log('Login attempt:', usuario, password);
        const result = await db.execute(
            "SELECT * FROM usuarios WHERE usuario = $1",
            [usuario]
        );
        const rows = result.rows || [];
        console.log('Login result:', rows.length, 'rows');
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const user = rows[0];
        if (!verificarPassword(password, user.password)) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        sesiones.set(token, { id: user.id, usuario: user.usuario, rol: user.rol });
        res.json({ success: true, token, user: { id: user.id, usuario: user.usuario, rol: user.rol } });
    } catch (err) {
        console.error('Error login:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Registrar usuario
app.post('/registrar', registerLimiter, autenticarSesion, requiereRol('admin', 'superadmin'), async (req, res) => {
    try {
        const { usuario, password, rol } = req.body;
        await db.execute(
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)",
            [usuario, password, rol || 'admin']
        );
        res.json({ success: true, message: 'Usuario registrado' });
    } catch (err) {
        console.error('Error registro:', err);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

// Estado acceso
app.get('/estado-acceso', async (req, res) => {
    const bloqueado = await estaAccesoBloqueado();
    res.json({ bloqueado });
});

// Bloqueo acceso
app.post('/bloqueo-acceso', requiereRol('superadmin'), async (req, res) => {
    try {
        const { bloquear } = req.body;
        await setAccesoBloqueado(bloquear);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

// Health
app.get('/health', (req, res) => { res.json({ status: 'ok' }); });
app.get('/debug', (req, res) => {
    res.json({ status: '✅ Online', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// 404
app.use((req, res) => { res.status(404).json({ message: "No encontrado" }); });

// Error general
app.use((err, req, res, next) => {
    console.error("Error:", err);
    res.status(500).json({ message: "Error interno del servidor" });
});

// ============ INICIAR ============
const PORT = process.env.PORT || 3020;
app.listen(PORT, () => {
    console.log(`🚀 Servidor encuesta en puerto ${PORT}`);
    initSistemaConfig().catch(console.error);
});
