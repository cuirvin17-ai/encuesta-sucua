const https = require('https');

// First login as irvin
function login() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ usuario: 'irvin', password: 'admin123' });
        const req = https.request({
            hostname: 'veedores-sucua.onrender.com',
            path: '/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                const j = JSON.parse(body);
                console.log('Login:', j.success, j.token ? 'token:' + j.token.substring(0,10) + '...' : j.message);
                resolve(j.token);
            });
        });
        req.write(data); req.end();
    });
}

function save(token) {
    return new Promise((resolve, reject) => {
        const payload = {
            junta_id: 47,
            id_veedor: 2,
            dignidad: 'ALCALDE',
            sobreescribir: true,
            votos: [
                { candidato: 'Crhistian Perez', votos: 5 },
                { candidato: 'Sebastian Rodriguez', votos: 3 },
                { candidato: 'NULO', votos: 1 }
            ]
        };
        const data = JSON.stringify(payload);
        const req = https.request({
            hostname: 'veedores-sucua.onrender.com',
            path: '/registrar-resultados',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Authorization': 'Bearer ' + token
            }
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                console.log('Status:', res.statusCode);
                console.log('Body:', body);
                resolve();
            });
        });
        req.write(data); req.end();
    });
}

async function run() {
    const token = await login();
    if (token) await save(token);
}
run();
