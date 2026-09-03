/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * Script: zona.js - Selección de Zona con Soporte Offline
 */

const API_BASE_URL = window.location.origin;

function getApiHeaders(extra = {}) {
    const token = localStorage.getItem('authToken');
    return {
        'ngrok-skip-browser-warning': 'true',
        ...extra,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

// Guardamos el HTML original del <select> para poder restaurarlo (ALCALDE)
let SELECT_ORIGINAL_HTML = null;

function formatearDignidad(d) {
    switch (d) {
        case 'ALCALDE': return 'Alcalde';
        case 'CONCEJALES_URBANOS': return 'Concejales urbanos';
        case 'CONCEJALES_RURALES': return 'Concejales rurales';
        case 'JUNTAS_PARROQUIALES': return 'Juntas parroquiales';
        case 'PREGUNTAS': return 'Preguntas';
        default: return d || 'Alcalde';
    }
}

function getZonasPorDignidad(dignidad) {
    // 1) Concejales urbanos: solo zona urbana y suburbana (según tu lista en zona.html)
    const ZONA_URBANA_SUBURBANA = [
        'Barrio Centro',
        'Barrio Aeropuerto',
        'Barrio 5 de Esquinas',
        'Barrio Artesanos',
        'Barrio Nazareno',
        'Barrio 4 de Octubre',
        'Barrio 8 de Diciembre',
        'Barrio Progreso',
        'Barrio Nuevo Israel',
        'Barrio Upano',
        'Barrio Norte',
        'Barrio Terminal',
        'Barrio Amazonas',
        'Barrio 3 de Noviembre',
        'Barrio 12 de Febrero',
        'Barrio Sur',
        'Barrio Belen',
        'Barrio la Cruz',
        'Barrio Paraiso',
        'Barrio Huambinimi',
        'Barrio 31 de Agosto',
        'Barrio Providencia'
    ];

    // 2) Concejales rurales: barrios que pertenecen a Asunción, Huambi y Santa Marianita
    const ZONA_RURAL_ASUNCION_HUAMBI_SANTA = [
        // Parroquias Huambi
        'Huambi',
        'Corazon de Jesus',
        'Cristal',
        'Tesoro',
        'kayamas',
        'Cumbatza',
        'Cusuimi',

        // Parroquia Santa Marianita
        'Santa Marianita',
        'Arapicos',
        'Bellavista',
        'Sivino Noguera',
        'Los Laureles',

        // Parroquias Asuncion
        'Asuncion',
        'Diamante',
        'Kansar',
        'Nuevos Horizontes',
        'Utunkus Norte',
        'San Jose',
        'Santa Teresita',
        'Sunganza',
        'Uwe',
        'San Salvador',
        'San Marcos'
    ];

    // 3) Juntas parroquiales: primero se escoge la parroquia (luego en voto salen sus representantes)
    const PARROQUIAS_JUNTAS = [
        'Santa Marianita',
        'Asuncion',
        'Huambi'
    ];

    if (dignidad === 'CONCEJALES_URBANOS') return ZONA_URBANA_SUBURBANA;
    if (dignidad === 'CONCEJALES_RURALES') return ZONA_RURAL_ASUNCION_HUAMBI_SANTA;
    if (dignidad === 'JUNTAS_PARROQUIALES') return PARROQUIAS_JUNTAS;
    return null; // ALCALDE: usa el HTML original completo
}

function aplicarZonasPorDignidad(dignidad) {
    const select = document.getElementById('barriosSucua');
    if (!select) return;

    // Guardar HTML original solo una vez (la lista completa del cantón Sucúa)
    if (SELECT_ORIGINAL_HTML === null) {
        SELECT_ORIGINAL_HTML = select.innerHTML;
    }

    // Alcalde y Preguntas usan la lista completa original
    if (dignidad === 'ALCALDE' || dignidad === 'PREGUNTAS') {
        select.innerHTML = SELECT_ORIGINAL_HTML;
        return;
    }

    const zonas = getZonasPorDignidad(dignidad) || [];

    const opciones = [
        '<option value="" disabled selected>-- Seleccione un sector --</option>',
        ...zonas.map(z => `<option value="${z}">${z}</option>`)
    ];
    select.innerHTML = opciones.join('');

    // Ajustar el texto según dignidad
    const p = document.querySelector('.card p');
    if (p) {
        if (dignidad === 'JUNTAS_PARROQUIALES') {
            p.innerText = 'Seleccione la parroquia donde se realiza la encuesta:';
        } else {
            p.innerText = 'Seleccione el sector de Sucúa donde se realiza la encuesta:';
        }
    }
}

async function verificarBloqueoSesion() {
    if (localStorage.getItem('rolUsuario') === 'superadmin') return true;

    if (localStorage.getItem('sistemaAccesoBloqueado') === '1') {
        alert('🔒 El sistema está bloqueado. No puede continuar.');
        window.location.href = '../acceso/acceso.html';
        return false;
    }

    if (!navigator.onLine) return true;

    try {
        const res  = await fetch(`${API_BASE_URL}/estado-acceso`, { headers: getApiHeaders() });
        const data = await res.json();
        if (data.success && data.bloqueado) {
            localStorage.setItem('sistemaAccesoBloqueado', '1');
            alert('🔒 El sistema fue bloqueado por el administrador. Debe cerrar sesión.');
            window.location.href = '../acceso/acceso.html';
            return false;
        }
        localStorage.removeItem('sistemaAccesoBloqueado');
    } catch (err) {
        /* sin servidor */
    }
    return true;
}

document.addEventListener('DOMContentLoaded', async () => {
    const idUsuario           = localStorage.getItem('idUsuario');
    const nombreUsuarioActivo = localStorage.getItem('nombreUsuarioActivo');
    const dignidad            = localStorage.getItem('dignidadSeleccionada');

    if (!idUsuario || !nombreUsuarioActivo) {
        window.location.href = "../acceso/acceso.html";
        return;
    }

    // ✅ Si no hay dignidad seleccionada, enviamos a la pantalla nueva
    if (!dignidad) {
        window.location.href = "../dignidad/dignidad.html";
        return;
    }

    const puedeContinuar = await verificarBloqueoSesion();
    if (!puedeContinuar) return;

    const nombreDisp = document.getElementById('nombreEncuestador');
    if (nombreDisp) {
        nombreDisp.innerText =
            nombreUsuarioActivo.charAt(0).toUpperCase() + nombreUsuarioActivo.slice(1);
    }

    const zonaGuardada = localStorage.getItem("zonaSeleccionada");
    const select = document.getElementById('barriosSucua');
    aplicarZonasPorDignidad(dignidad);
    if (zonaGuardada && select) {
        select.value = zonaGuardada;
        activarBoton();
    }

    // Mostrar la dignidad en el título
    const h2 = document.querySelector('.card h2');
    if (h2) h2.innerText = `Ubicación del Voto — ${formatearDignidad(dignidad)}`;

    actualizarContadorPendientes();

    if (navigator.onLine) {
        sincronizarVotosPendientes();
    }
});

window.addEventListener('online', () => {
    sincronizarVotosPendientes();
});

// ============ SINCRONIZACIÓN DE VOTOS OFFLINE ============
async function sincronizarVotosPendientes() {
    let pendientes = JSON.parse(localStorage.getItem("votosOffline")) || [];
    if (pendientes.length === 0) return;

    let sincronizados = 0;

    for (let i = pendientes.length - 1; i >= 0; i--) {
        try {
            const voto = pendientes[i];
            const esPreguntas = Array.isArray(voto.respuestas) && voto.respuestas.length > 0;
            const endpoint = esPreguntas ? '/votar-preguntas' : '/votar';
            const res  = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(pendientes[i])
            });
            const data = await res.json();

            if (data.codigo === 'ACCESO_BLOQUEADO') {
                localStorage.setItem('sistemaAccesoBloqueado', '1');
                alert('🔒 El sistema está bloqueado. No se pueden sincronizar votos.');
                break;
            }

            if (data.success) {
                pendientes.splice(i, 1);
                sincronizados++;
            }
        } catch (err) {
            break;
        }
    }

    if (pendientes.length > 0) {
        localStorage.setItem("votosOffline", JSON.stringify(pendientes));
    } else {
        localStorage.removeItem("votosOffline");
    }

    if (sincronizados > 0) {
        actualizarContadorPendientes();
        mostrarNotificacionSync(sincronizados);
    }
}

// ============ CONTADOR DE PENDIENTES EN UI ============
function actualizarContadorPendientes() {
    const pendientes = JSON.parse(localStorage.getItem("votosOffline")) || [];
    const contador   = document.getElementById('contadorPendientes');

    if (!contador) return;

    if (pendientes.length > 0) {
        contador.style.display = 'block';
        contador.innerText     = `📦 ${pendientes.length} voto(s) pendiente(s) de enviar`;
    } else {
        contador.style.display = 'none';
    }
}

// ============ NOTIFICACIÓN VISUAL SINCRONIZACIÓN ============
function mostrarNotificacionSync(cantidad) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        background: #00a884; color: #fff; padding: 12px 24px;
        border-radius: 12px; font-weight: 700; font-size: 0.95rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25); z-index: 9999;
    `;
    notif.innerText = `✅ ${cantidad} voto(s) enviado(s) al servidor`;
    document.body.appendChild(notif);

    setTimeout(() => {
        notif.style.transition = 'opacity 0.5s';
        notif.style.opacity    = '0';
        setTimeout(() => notif.remove(), 500);
    }, 3000);
}

// ============ ACTIVAR BOTÓN ============
function activarBoton() {
    const select = document.getElementById('barriosSucua');
    const btn    = document.getElementById('btnNext');
    if (!select || !btn) return;

    if (select.value !== "") {
        btn.disabled = false;
        btn.classList.add('active');
    } else {
        btn.disabled = true;
        btn.classList.remove('active');
    }
}

// ============ IR A VOTAR ============
function irAVoto() {
    const select = document.getElementById('barriosSucua');
    if (!select || select.value === "") {
        alert("⚠️ Por favor, selecciona un barrio para continuar.");
        return;
    }

    localStorage.setItem("zonaSeleccionada", select.value);

    const card = document.querySelector('.card');
    if (card) {
        card.style.opacity    = "0";
        card.style.transform  = "translateY(-20px)";
        card.style.transition = "0.4s all ease";
    }

    setTimeout(() => {
        window.location.href = "../voto/voto.html";
    }, 300);
}

// ============ VOLVER A DIGNIDAD ============
function irADignidad() {
    // Al cambiar de dignidad, se debe volver a escoger la zona
    localStorage.removeItem("zonaSeleccionada");
    window.location.href = "../dignidad/dignidad.html";
}

// ============ CERRAR SESIÓN ============
function cerrarSesion() {
    if (confirm("¿Desea cerrar la sesión?")) {
        localStorage.removeItem("idUsuario");
        localStorage.removeItem("nombreUsuarioActivo");
        localStorage.removeItem("rolUsuario");
        localStorage.removeItem("dignidadSeleccionada");
        localStorage.removeItem("zonaSeleccionada");
        localStorage.removeItem("sesionActiva");
        localStorage.removeItem("authToken");
        window.location.href = "../acceso/acceso.html";
    }
}
