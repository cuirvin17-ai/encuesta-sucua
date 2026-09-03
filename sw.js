/**
 * sw.js - Service Worker
 * Sistema de Encuestas Sucúa 2026
 */

// ✅ Bump de versión por cambios de ruta y assets
const CACHE_NAME    = 'sucua-v26';
const RUNTIME_CACHE = 'sucua-runtime-v10';

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sin Conexión — Sucúa 2026</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f0fdf4;display:flex;flex-direction:column;
      align-items:center;justify-content:center;min-height:100vh;
      padding:24px;text-align:center}
    .icon{font-size:3rem;margin-bottom:16px}
    h2{color:#065f46;font-size:1.3rem;margin-bottom:10px}
    p{color:#6b7280;font-size:0.95rem;margin-bottom:24px;line-height:1.5}
    button{background:#00a884;color:#fff;border:none;padding:14px 32px;
      border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer}
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h2>Sin conexión a Internet</h2>
  <p>Conecta el dispositivo a la red WiFi o datos<br>e intenta de nuevo.</p>
  <button onclick="location.reload()">🔄 Reintentar</button>
</body>
</html>`;

const CRITICAL_ASSETS = [
    './acceso/acceso.html',
    './acceso/acceso.js',
    './acceso/style.css',
    './dignidad/dignidad.html',
    './dignidad/dignidad.js',
    './zona/zona.html',
    './zona/zona.js',
    './zona/style.css',
    './administrador/admin.html',
    './administrador/admin.js',
    './administrador/style.css',
    './voto/voto.html',
    './voto/voto.js',
    './voto/style.css',
    './voto/1.jpg',
    './voto/2.jpg',
    './voto/3.jpg',
    './voto/4.jpg',
    './voto/5.jpg',
    './voto/6.jpg',
    './voto/placeholder-candidato.svg',
    './registro/registro.html',
    './registro/registro.js',
    './registro/style.css',
    './manifest.json',
    './icon-512.png',
    './icon-192.png'
];

// ============ INSTALACIÓN ============
self.addEventListener('install', event => {
    console.log('[SW] Instalando', CACHE_NAME);

    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            let ok = 0, fail = 0;

            for (const asset of CRITICAL_ASSETS) {
                try {
                    await cache.add(asset);
                    ok++;
                } catch (err) {
                    fail++;
                    console.warn('[SW] No cacheado:', asset, '-', err.message);
                }
            }

            console.log(`[SW] ${ok} OK, ${fail} fallidos`);

            if (ok >= Math.floor(CRITICAL_ASSETS.length / 2)) {
                self.skipWaiting();
                console.log('[SW] Instalación exitosa');
            } else {
                console.warn('[SW] Muy pocos archivos cacheados, manteniendo SW anterior');
            }
        })
    );
});

// ============ ACTIVACIÓN ============
self.addEventListener('activate', event => {
    console.log('[SW] Activando...');

    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
                    .map(k => {
                        console.log('[SW] Eliminando caché antiguo:', k);
                        return caches.delete(k);
                    })
            )
        ).then(() => {
            self.clients.claim();
            console.log('[SW] Activación completada');
        })
    );
});

// ============ FETCH ============
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // ✅ CORRECCIÓN:
    // Las páginas están en /encuesta/* — SÍ interceptar (servir desde caché)
    // Las APIs están en la raíz /* (/login, /votar, etc.) — NO interceptar
    const esRutaAPI = !url.pathname.startsWith('/encuesta');
    if (esRutaAPI) return;

    // No interceptar POST/PUT/DELETE
    if (request.method !== 'GET') return;

    // No interceptar CDNs externos
    if (url.hostname.includes('cdnjs') ||
        url.hostname.includes('jsdelivr') ||
        url.hostname.includes('googleapis')) return;

    event.respondWith(
        caches.match(request).then(cached => {
            // Servir desde caché si existe
            if (cached) {
                console.log('[SW] Caché:', url.pathname);
                return cached;
            }

            // Si no está en caché, intentar red
            return fetch(request)
                .then(networkRes => {
                    if (networkRes && networkRes.status === 200) {
                        const clone = networkRes.clone();
                        caches.open(RUNTIME_CACHE).then(c => c.put(request, clone));
                    }
                    return networkRes;
                })
                .catch(() => {
                    console.warn('[SW] Sin red:', url.pathname);

                    // Para navegación: login cacheado o fallback embebido
                    if (request.mode === 'navigate') {
                        return caches.match('./acceso/acceso.html')
                            .then(r => r || new Response(OFFLINE_HTML, {
                                headers: { 'Content-Type': 'text/html; charset=utf-8' }
                            }));
                    }

                    return new Response('Sin conexión', { status: 503 });
                });
        })
    );
});
