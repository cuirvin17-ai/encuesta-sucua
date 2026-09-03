/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * Archivo: acceso.js — Versión Final
 */

// === 1. VARIABLES GLOBALES ===
let deferredPrompt = null;
const API_BASE_URL = window.location.origin;

function getApiHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return {
        'ngrok-skip-browser-warning': 'true',
        ...extra,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

// === 2. REGISTRO DEL SERVICE WORKER ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('../sw.js');
            console.log('✅ Service Worker activo:', reg.scope);
            reg.update();
        } catch (err) {
            console.error('❌ Error al registrar SW:', err);
        }
    });
}

// === 3. EVENTO: APLICACIÓN PUEDE INSTALARSE ===
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('✅ PWA instalable detectada');
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installBtn');
    if (installBtn) installBtn.style.display = 'block';
});

// === 4. EVENTO: APLICACIÓN INSTALADA ===
window.addEventListener('appinstalled', () => {
    console.log('✅ PWA instalada exitosamente');
    localStorage.setItem('pwaInstalada', 'true');
    const installBtn = document.getElementById('installBtn');
    if (installBtn) installBtn.style.display = 'none';
});

// === 5. DETECTOR DE CONEXIÓN ===
function checkConnectivity() {
    const offlineMsg = document.getElementById('offline-msg');
    if (!offlineMsg) return;
    offlineMsg.style.display = navigator.onLine ? 'none' : 'block';
}

window.addEventListener('online',  checkConnectivity);
window.addEventListener('offline', checkConnectivity);

// === 6. INICIALIZACIÓN (UN SOLO DOMContentLoaded) ===
document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!deferredPrompt) {
                console.log('❌ No hay prompt disponible');
                return;
            }
            try {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    console.log('✅ PWA instalada');
                    alert('✅ ¡Aplicación instalada! Puedes usarla sin conexión.');
                }
                deferredPrompt = null;
                installBtn.style.display = 'none';
            } catch (err) {
                console.error('Error instalando PWA:', err);
            }
        });
    }

    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', validarIngreso);
    }

    checkConnectivity();
    verificarAvisoAccesoBloqueado();
});

// === 7. CODIFICACIÓN DE CONTRASEÑA ===
function codificarPassword(pass) {
    return btoa(unescape(encodeURIComponent(pass)));
}

// === 8. VALIDACIÓN DE INGRESO ===
async function validarIngreso(e) {
    if (e) e.preventDefault();

    const user = document.getElementById('user')?.value.trim();
    const pass = document.getElementById('pass')?.value.trim();
    const btn  = document.getElementById('btnIngresar');

    console.log('========== INICIANDO VALIDACIÓN ==========');
    console.log('Usuario:', user);

    if (!user || !pass) {
        alert("⚠️ Por favor, ingresa usuario y contraseña");
        return;
    }

    if (btn) { btn.disabled = true; btn.innerText = "Verificando..."; }

    if (navigator.onLine) {
        console.log('🌐 MODO ONLINE');
        try {
            const respuesta = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ usuario: user, password: pass })
            });

            if (!respuesta.ok) {
                const errorData = await respuesta.json().catch(() => ({}));
                if (errorData.codigo === 'ACCESO_BLOQUEADO') {
                    localStorage.setItem('sistemaAccesoBloqueado', '1');
                    mostrarAvisoBloqueo(true);
                }
                alert(`❌ ${errorData.message || 'Credenciales incorrectas'}`);
                if (btn) { btn.disabled = false; btn.innerText = "Ingresar al Sistema"; }
                return;
            }

            const data = await respuesta.json();

            if (data.success) {
                console.log('✅ LOGIN ONLINE EXITOSO:', data.user.usuario, '|', data.user.rol);

                localStorage.setItem("idUsuario",           data.user.id);
                localStorage.setItem("nombreUsuarioActivo", data.user.usuario);
                localStorage.setItem("rolUsuario",          data.user.rol);
                localStorage.setItem("sesionActiva",        "true");
                if (data.token) localStorage.setItem('authToken', data.token);
                else localStorage.removeItem('authToken');
                localStorage.removeItem('sistemaAccesoBloqueado');

                try {
                    await guardarCredencialesOffline(user, pass, data.user.rol, data.user.id);
                    console.log('✅ Credenciales offline guardadas');
                } catch (err) {
                    console.error('⚠️ Error guardando credenciales offline:', err.message);
                    alert('⚠️ Las credenciales no se guardaron para uso offline.');
                }

                redirigirSegunRol(data.user.rol);

            } else {
                alert('❌ Credenciales incorrectas');
            }

        } catch (error) {
            console.error("❌ Error de red:", error.message);
            console.log('📴 Intentando acceso offline...');
            await intentarAccesoOffline(user, pass);
        }

    } else {
        console.log('📴 MODO OFFLINE');
        await intentarAccesoOffline(user, pass);
    }

    if (btn) { btn.disabled = false; btn.innerText = "Ingresar al Sistema"; }
    console.log('========== FIN VALIDACIÓN ==========\n');
}

// === 9. GUARDAR CREDENCIALES OFFLINE ===
async function guardarCredencialesOffline(user, pass, rol, id) {
    const usuarioKey  = user.trim().toLowerCase();
    const passEncoded = codificarPassword(pass);

    const datosUsuario = {
        passEncoded,
        rol,
        id,
        timestamp: new Date().toISOString()
    };

    localStorage.setItem(`user_${usuarioKey}`, JSON.stringify(datosUsuario));

    const verificar = localStorage.getItem(`user_${usuarioKey}`);
    if (!verificar) throw new Error('Fallo la verificación del guardado');

    console.log(`✅ Credenciales guardadas: ${usuarioKey}`);
    console.log('📋 Usuarios en caché:', Object.keys(localStorage).filter(k => k.startsWith('user_')));
    return true;
}

// === 10. ACCESO OFFLINE ===
async function intentarAccesoOffline(user, pass) {
    const userKey     = user.trim().toLowerCase();
    const passEncoded = codificarPassword(pass);

    console.log('📴 Buscando usuario offline:', userKey);

    const storedData = localStorage.getItem(`user_${userKey}`);

    if (!storedData) {
        console.warn('❌ Usuario no encontrado en caché');
        console.log('📋 Disponibles:', Object.keys(localStorage).filter(k => k.startsWith('user_')));
        alert("❌ Este usuario no tiene sesión guardada.\n\nNecesitas internet para el primer acceso.");
        return false;
    }

    const userParsed = JSON.parse(storedData);

    if (localStorage.getItem('sistemaAccesoBloqueado') === '1' && userParsed.rol !== 'superadmin') {
        alert('🔒 El sistema está bloqueado. No puede ingresar en este momento.');
        return false;
    }

    if (passEncoded !== userParsed.passEncoded) {
        console.warn('❌ Contraseña incorrecta en modo offline');
        alert("❌ Contraseña incorrecta");
        return false;
    }

    localStorage.setItem("idUsuario",           userParsed.id);
    localStorage.setItem("nombreUsuarioActivo", userKey);
    localStorage.setItem("rolUsuario",          userParsed.rol);
    localStorage.setItem("sesionActiva",        "true");

    console.log('✅ LOGIN OFFLINE EXITOSO:', userKey);
    alert("✅ Modo Offline: Sesión iniciada con datos guardados.");

    redirigirSegunRol(userParsed.rol);
    return true;
}

// === 10b. AVISO BLOQUEO DE ACCESO ===
async function verificarAvisoAccesoBloqueado() {
    if (!navigator.onLine) {
        mostrarAvisoBloqueo(localStorage.getItem('sistemaAccesoBloqueado') === '1');
        return;
    }
    try {
        const res  = await fetch(`${API_BASE_URL}/estado-acceso`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) {
            if (data.bloqueado) localStorage.setItem('sistemaAccesoBloqueado', '1');
            else localStorage.removeItem('sistemaAccesoBloqueado');
            mostrarAvisoBloqueo(!!data.bloqueado);
        }
    } catch (e) {
        /* sin conexión al servidor */
    }
}

function mostrarAvisoBloqueo(activo) {
    let el = document.getElementById('aviso-acceso-bloqueado');
    if (!el) {
        el = document.createElement('div');
        el.id = 'aviso-acceso-bloqueado';
        el.style.cssText = 'display:none;margin-bottom:14px;padding:12px 14px;background:#fef3c7;border:1.5px solid #f59e0b;border-radius:12px;color:#92400e;font-size:0.85rem;font-weight:600;text-align:center;line-height:1.4;';
        const card = document.querySelector('.login-card');
        if (card) card.insertBefore(el, card.firstChild);
    }
    el.style.display = activo ? 'block' : 'none';
    if (activo) {
        el.innerHTML = '🔒 Sistema bloqueado temporalmente. Solo el superadministrador puede ingresar.';
    }
}

// === 11. REDIRECCIÓN POR ROL ===
function redirigirSegunRol(rol) {
    console.log('🔄 Redirigiendo con rol:', rol);
    if (rol === 'admin' || rol === 'superadmin') {
        window.location.href = "../administrador/admin.html";
    } else {
        localStorage.removeItem("dignidadSeleccionada");
        localStorage.removeItem("zonaSeleccionada");
        window.location.href = "../dignidad/dignidad.html";
    }
}

// === 12. HERRAMIENTAS DE DIAGNÓSTICO ===
window.diagnosticoPWA = {
    clearCache: async () => {
        const names   = await caches.keys();
        const results = await Promise.all(names.map(n => caches.delete(n)));
        console.log(`✅ ${results.length} cachés eliminados`);
    },

    clearSesion: () => {
        localStorage.removeItem("idUsuario");
        localStorage.removeItem("nombreUsuarioActivo");
        localStorage.removeItem("rolUsuario");
        localStorage.removeItem("dignidadSeleccionada");
        localStorage.removeItem("zonaSeleccionada");
        localStorage.removeItem("sesionActiva");
        localStorage.removeItem("authToken");
        console.log('✅ Sesión limpiada. Credenciales offline conservadas.');
    },

    clearTodo: () => {
        localStorage.clear();
        console.log('✅ localStorage completamente limpiado (credenciales eliminadas)');
    },

    reloadSW: async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => r.unregister());
        console.log('✅ Service Workers desinstalados. Recarga la página.');
    },

    getStatus: () => {
        const usuarios = Object.keys(localStorage).filter(k => k.startsWith('user_'));
        const status = {
            online:            navigator.onLine,
            swSupported:       'serviceWorker' in navigator,
            sesionActiva:      localStorage.getItem('sesionActiva'),
            idUsuario:         localStorage.getItem('idUsuario'),
            rolUsuario:        localStorage.getItem('rolUsuario'),
            authToken:         localStorage.getItem('authToken'),
            usuariosEnCache:   usuarios.length,
            detalleUsuarios:   usuarios.map(k => ({
                clave: k,
                datos: JSON.parse(localStorage.getItem(k))
            }))
        };
        console.log('📊 Estado PWA:', status);
        return status;
    },

    testLocalStorage: () => {
        try {
            const key = 'test_' + Date.now();
            localStorage.setItem(key, 'ok');
            const ok = localStorage.getItem(key) === 'ok';
            localStorage.removeItem(key);
            console.log(ok ? '✅ localStorage funciona correctamente' : '❌ localStorage con problemas');
            return ok;
        } catch (err) {
            console.error('❌ Error en localStorage:', err);
            return false;
        }
    }
};

console.log('✅ acceso.js cargado correctamente');
console.log('💡 Diagnóstico disponible en consola:');
console.log('   - diagnosticoPWA.getStatus()');
console.log('   - diagnosticoPWA.clearSesion()');
console.log('   - diagnosticoPWA.clearTodo()');
console.log('   - diagnosticoPWA.clearCache()');
console.log('   - diagnosticoPWA.reloadSW()');
console.log('   - diagnosticoPWA.testLocalStorage()');
