/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * Script: dignidad.js - Selección de dignidad
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

const DIGNIDADES_ORDEN = ['ALCALDE', 'CONCEJALES_URBANOS', 'CONCEJALES_RURALES', 'JUNTAS_PARROQUIALES', 'PREGUNTAS'];

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

function activarBoton() {
    const select = document.getElementById('selectDignidad');
    const btn    = document.getElementById('btnNextDignidad');
    if (!select || !btn) return;

    if (select.value) {
        btn.disabled = false;
        btn.classList.add('active');
    } else {
        btn.disabled = true;
        btn.classList.remove('active');
    }
}

function mostrarMensajeEstado(mensaje, tipo = 'info') {
    const card = document.querySelector('.card');
    if (!card) return;

    let el = document.getElementById('dignidadEstado');
    if (!el) {
        el = document.createElement('div');
        el.id = 'dignidadEstado';
        el.style.cssText = 'margin-bottom:16px;padding:12px 14px;border-radius:12px;font-size:0.88rem;line-height:1.5;font-weight:600;';
        const form = document.getElementById('formDignidad');
        if (form) form.parentNode.insertBefore(el, form);
    }

    if (tipo === 'error') {
        el.style.background = '#fee2e2';
        el.style.border = '1.5px solid #fca5a5';
        el.style.color = '#991b1b';
    } else if (tipo === 'warning') {
        el.style.background = '#fef3c7';
        el.style.border = '1.5px solid #fbbf24';
        el.style.color = '#92400e';
    } else {
        el.style.background = '#ecfdf5';
        el.style.border = '1.5px solid #a7f3d0';
        el.style.color = '#065f46';
    }

    el.textContent = mensaje;
    el.style.display = 'block';
}

function ocultarMensajeEstado() {
    const el = document.getElementById('dignidadEstado');
    if (el) el.style.display = 'none';
}

function crearOpcionDignidad(clave, habilitada, seleccionadaActual) {
    const option = document.createElement('option');
    option.value = clave;
    option.textContent = formatearDignidad(clave);

    if (!habilitada) {
        option.disabled = true;
        option.textContent = `${formatearDignidad(clave)} (deshabilitada)`;
    }

    if (seleccionadaActual === clave && habilitada) {
        option.selected = true;
    }

    return option;
}

async function cargarDignidadesDisponibles() {
    const select = document.getElementById('selectDignidad');
    const btn = document.getElementById('btnNextDignidad');
    if (!select || !btn) return;

    const seleccionGuardada = localStorage.getItem('dignidadSeleccionada');
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = '-- Seleccione una dignidad --';
    select.appendChild(placeholder);

    try {
        const res = await fetch(`${API_BASE_URL}/dignidades-estado`, {
            headers: getApiHeaders()
        });
        const data = await res.json();

        if (!data.success || !Array.isArray(data.dignidades)) {
            throw new Error('No se pudo leer la configuración');
        }

        const disponibles = data.dignidades
            .slice()
            .sort((a, b) => DIGNIDADES_ORDEN.indexOf(a.clave) - DIGNIDADES_ORDEN.indexOf(b.clave));

        const habilitadas = disponibles.filter(d => d.habilitada);

        habilitadas.forEach(d => {
            select.appendChild(crearOpcionDignidad(d.clave, true, seleccionGuardada));
        });

        if (seleccionGuardada) {
            const encontrada = disponibles.find(d => d.clave === seleccionGuardada);
            if (!encontrada || !encontrada.habilitada) {
                localStorage.removeItem('dignidadSeleccionada');
                select.value = '';
                mostrarMensajeEstado('La dignidad guardada ya no está habilitada. Seleccione una nueva opción.', 'warning');
            } else {
                select.value = seleccionGuardada;
                ocultarMensajeEstado();
            }
        }

        if (habilitadas.length === 0) {
            select.disabled = true;
            btn.disabled = true;
            btn.classList.remove('active');
            mostrarMensajeEstado('No hay dignidades habilitadas en este momento. Contacte al superadministrador.', 'warning');
            return;
        }

        select.disabled = false;
        activarBoton();
        if (!seleccionGuardada) {
            mostrarMensajeEstado('Seleccione una dignidad habilitada para continuar.', 'info');
        }
    } catch (err) {
        select.innerHTML = '';
        const fallback = [
            { clave: 'ALCALDE', habilitada: true },
            { clave: 'CONCEJALES_URBANOS', habilitada: true },
            { clave: 'CONCEJALES_RURALES', habilitada: true },
            { clave: 'JUNTAS_PARROQUIALES', habilitada: true },
            { clave: 'PREGUNTAS', habilitada: true }
        ];
        fallback.forEach(d => select.appendChild(crearOpcionDignidad(d.clave, d.habilitada, seleccionGuardada)));

        if (seleccionGuardada) {
            select.value = seleccionGuardada;
        }
        activarBoton();
        mostrarMensajeEstado('No se pudo leer la configuración del servidor. Se muestran todas las dignidades temporalmente.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const idUsuario           = localStorage.getItem('idUsuario');
    const nombreUsuarioActivo = localStorage.getItem('nombreUsuarioActivo');

    if (!idUsuario || !nombreUsuarioActivo) {
        window.location.href = "../acceso/acceso.html";
        return;
    }

    const nombreDisp = document.getElementById('nombreEncuestador');
    if (nombreDisp) {
        nombreDisp.innerText =
            nombreUsuarioActivo.charAt(0).toUpperCase() + nombreUsuarioActivo.slice(1);
    }

    const select = document.getElementById('selectDignidad');
    if (select) {
        select.addEventListener('change', activarBoton);
    }

    await cargarDignidadesDisponibles();

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
            const res = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(voto)
            });
            const data = await res.json();

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
        mostrarNotificacionSync(sincronizados);
    }
}

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

function irAZona() {
    const select = document.getElementById('selectDignidad');
    if (!select || !select.value) {
        alert('⚠️ Por favor, seleccione una dignidad.');
        return;
    }

    localStorage.setItem('dignidadSeleccionada', select.value);
    // Al cambiar de dignidad, se debe volver a escoger la zona
    localStorage.removeItem('zonaSeleccionada');

    window.location.href = "../zona/zona.html";
}

function cerrarSesion() {
    if (confirm("¿Desea cerrar la sesión?")) {
        localStorage.removeItem("idUsuario");
        localStorage.removeItem("nombreUsuarioActivo");
        localStorage.removeItem("rolUsuario");
        localStorage.removeItem("dignidadSeleccionada");
        localStorage.removeItem("zonaSeleccionada");
        localStorage.removeItem("sesionActiva");
        window.location.href = "../acceso/acceso.html";
    }
}
