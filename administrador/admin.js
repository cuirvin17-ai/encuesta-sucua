/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * admin.js — Dashboard de Administración
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

// Dignidad seleccionada para el análisis (se guarda en localStorage)
function getDignidadActual() {
    return localStorage.getItem('adminDignidad') || 'ALCALDE';
}

function setDignidadActual(d) {
    localStorage.setItem('adminDignidad', d || 'ALCALDE');
}

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

async function cargarFiltroDignidad() {
    const select = document.getElementById('filtroDignidad');
    if (!select) return;

    try {
        const res = await fetch(`${API_BASE_URL}/dignidades-estado`, {
            headers: getApiHeaders()
        });
        const data = await res.json();

        if (!data.success || !Array.isArray(data.dignidades)) {
            throw new Error('No se pudo leer la configuración');
        }

        const items = (esSuperadmin()
            ? data.dignidades
            : data.dignidades.filter(d => d.habilitada))
            .filter(d => d.clave !== 'PREGUNTAS');

        select.innerHTML = items.map(d =>
            `<option value="${d.clave}">${formatearDignidad(d.clave)}</option>`
        ).join('');

        const guardada = getDignidadActual();
        if (guardada && items.some(d => d.clave === guardada)) {
            select.value = guardada;
        }
    } catch (err) {
        console.error('Error cargando filtro dignidad:', err);
    }
}

async function cargarEstadoDignidades() {
    if (!esSuperadmin()) return;

    const panel = document.getElementById('panelDignidades');
    if (!panel) return;

    panel.innerHTML = `
        <div class="panel-dignidades-loading">
            <i class="fas fa-circle-notch fa-spin"></i> Cargando dignidades...
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE_URL}/dignidades-estado`, {
            headers: getApiHeaders()
        });
        const data = await res.json();

        if (!data.success) {
            panel.innerHTML = '<p class="panel-dignidades-error">No se pudo cargar la configuración.</p>';
            return;
        }

        panel.innerHTML = data.dignidades.map(d => `
            <div class="dignidad-toggle ${d.habilitada ? 'activa' : 'inactiva'}">
                <div class="dignidad-toggle-info">
                    <strong>${formatearDignidad(d.clave)}</strong>
                    <small>${d.clave}</small>
                </div>
                <button type="button"
                        class="dignidad-switch ${d.habilitada ? 'on' : 'off'}"
                        onclick="toggleDignidad('${d.clave}', ${d.habilitada ? 'false' : 'true'})">
                    <span class="dignidad-switch-knob"></span>
                    <span class="dignidad-switch-text">${d.habilitada ? 'Habilitada' : 'Deshabilitada'}</span>
                </button>
            </div>
        `).join('');
    } catch (err) {
        panel.innerHTML = '<p class="panel-dignidades-error">Error de conexión al cargar dignidades.</p>';
    }
}

async function toggleDignidad(clave, habilitada) {
    if (!esSuperadmin()) return;

    const msg = habilitada
        ? `¿Habilitar ${formatearDignidad(clave)}?`
        : `¿Deshabilitar ${formatearDignidad(clave)}?`;

    if (!confirm(msg)) return;

    try {
        const res = await fetch(`${API_BASE_URL}/dignidades-estado/${encodeURIComponent(clave)}`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ habilitada })
        });
        const data = await res.json();

        if (data.success) {
            await cargarEstadoDignidades();
            await cargarFiltroDignidad();
            alert(`✅ ${data.message}`);
        } else {
            alert('❌ ' + (data.message || 'No se pudo actualizar la dignidad'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión al actualizar la dignidad.');
    }
}

// ============ INICIALIZACIÓN ============
document.addEventListener('DOMContentLoaded', async () => {
    const idUsuario           = localStorage.getItem('idUsuario');
    const nombreUsuarioActivo = localStorage.getItem('nombreUsuarioActivo');
    const rolUsuario          = localStorage.getItem('rolUsuario');

    if (!idUsuario || (rolUsuario !== 'admin' && rolUsuario !== 'superadmin')) {
        window.location.href = "../acceso/acceso.html";
        return;
    }

    configurarUISuperadmin();
    verificarBloqueoPanelAdmin();

    const adminDisplay = document.getElementById('adminNombre');
    if (adminDisplay && nombreUsuarioActivo) {
        adminDisplay.innerText =
            nombreUsuarioActivo.charAt(0).toUpperCase() + nombreUsuarioActivo.slice(1);
    }

    const pendientes = JSON.parse(localStorage.getItem('votosOffline')) || [];
    const elPend = document.getElementById('votosPendientes');
    if (elPend) elPend.innerText = pendientes.length;

    sincronizarMenuResponsive();
    window.addEventListener('resize', sincronizarMenuResponsive);

    await cargarFiltroDignidad();
    inicializarDashboard();

    const filtro = document.getElementById('filtroZona');
    if (filtro) filtro.addEventListener('change', cargarEstadisticas);

    const filtroD = document.getElementById('filtroDignidad');
    if (filtroD) {
        filtroD.addEventListener('change', async () => {
            setDignidadActual(filtroD.value);
            await inicializarDashboard();
        });
    }

    if (esSuperadmin()) {
        cargarEstadoDignidades();
    }

    verificarVisibilidadMapa();
    verificarVisibilidadRespuestas();

    // Auto-refresh cada 30 segundos
    setInterval(async () => {
        await cargarTablaFija();
        await cargarEstadisticas();
        await cargarDesgloseCandidato();

        const pend = JSON.parse(localStorage.getItem('votosOffline')) || [];
        const elP  = document.getElementById('votosPendientes');
        if (elP) elP.innerText = pend.length;

        actualizarRelojRefresh();
    }, 30000);

    actualizarRelojRefresh();
});

// ============ SUPERADMIN ============
function getRolAdmin() {
    return localStorage.getItem('rolUsuario') || '';
}

function esSuperadmin() {
    return getRolAdmin() === 'superadmin';
}

function configurarUISuperadmin() {
    const grupo = document.getElementById('menuSuperadminGroup');
    if (grupo) grupo.style.display = esSuperadmin() ? 'block' : 'none';
    if (esSuperadmin()) {
        document.querySelectorAll('#menuSuperadminGroup .menu-item').forEach(el => {
            el.style.display = 'flex';
        });
    }
}

function actualizarUIBloqueoAcceso(bloqueado) {
    const btn   = document.getElementById('btnToggleAcceso');
    const texto = document.getElementById('estadoAccesoTexto');
    if (!btn || !texto) return;

    btn.dataset.bloqueado = bloqueado ? '1' : '0';

    if (bloqueado) {
        texto.textContent = 'BLOQUEADO: administradores y encuestadores no pueden ingresar ni registrar votos. Solo tú (superadmin) tiene acceso.';
        btn.className = 'btn-toggle-acceso desbloquear';
        btn.innerHTML = '<i class="fas fa-lock-open"></i> Desbloquear acceso';
    } else {
        texto.textContent = 'Acceso normal: admin y encuestadores pueden ingresar y trabajar.';
        btn.className = 'btn-toggle-acceso bloquear';
        btn.innerHTML = '<i class="fas fa-ban"></i> Bloquear acceso';
    }
}

async function verificarBloqueoPanelAdmin() {
    if (esSuperadmin()) return;
    try {
        const res  = await fetch(`${API_BASE_URL}/estado-acceso`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success && data.bloqueado) {
            alert('🔒 El sistema fue bloqueado por el superadministrador. Su sesión se cerrará.');
            localStorage.clear();
            window.location.href = '../acceso/acceso.html';
        }
    } catch (err) {
        /* sin conexión */
    }
}

async function cargarEstadoAcceso() {
    if (!esSuperadmin()) return;
    try {
        const res  = await fetch(`${API_BASE_URL}/estado-acceso`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) actualizarUIBloqueoAcceso(!!data.bloqueado);
    } catch (err) {
        const texto = document.getElementById('estadoAccesoTexto');
        if (texto) texto.textContent = 'No se pudo cargar el estado de acceso.';
    }
}

async function toggleBloqueoAcceso() {
    if (!esSuperadmin()) return;

    const btn       = document.getElementById('btnToggleAcceso');
    const bloqueado = btn?.dataset.bloqueado === '1';
    const nuevoEstado = !bloqueado;

    const msg = nuevoEstado
        ? '¿Bloquear el acceso?\n\nNingún administrador ni encuestador podrá ingresar ni registrar votos hasta que lo desbloquees.'
        : '¿Desbloquear el acceso?\n\nAdmin y encuestadores podrán ingresar con normalidad.';
    if (!confirm(msg)) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/bloqueo-acceso`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ bloquear: nuevoEstado })
        });
        const data = await res.json();

        if (data.success) {
            actualizarUIBloqueoAcceso(!!data.bloqueado);
            localStorage.setItem('sistemaAccesoBloqueado', data.bloqueado ? '1' : '0');
            alert('✅ ' + data.message);
        } else {
            alert('❌ ' + (data.message || 'No se pudo cambiar el bloqueo'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión.');
    } finally {
        if (btn) btn.disabled = false;
        await cargarEstadoAcceso();
    }
}

async function reiniciarEncuesta() {
    if (!esSuperadmin()) return;

    const msg1 = '¿Reiniciar la encuesta?\n\nSe eliminarán TODOS los votos registrados en el sistema.';
    if (!confirm(msg1)) return;

    const confirmacion = prompt('Escriba REINICIAR para confirmar:');
    if (confirmacion !== 'REINICIAR') {
        alert('Operación cancelada.');
        return;
    }

    const btn = document.getElementById('btnReiniciarEncuesta');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Reiniciando...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/reiniciar-encuesta`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({})
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ ${data.message}\n\nVotos eliminados: ${data.eliminados ?? 0}`);
            await inicializarDashboard();
        } else {
            alert('❌ ' + (data.message || 'No se pudo reiniciar'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión al reiniciar la encuesta.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash-can"></i> Reiniciar votos a cero';
        }
    }
}

// ============ MENÚ LATERAL (móvil y escritorio) ============
function esVistaMovil() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function abrirMenu() {
    document.querySelector('.admin-container')?.classList.add('sidebar-is-open');
    if (esVistaMovil()) document.body.style.overflow = 'hidden';
}

function cerrarMenu() {
    document.querySelector('.admin-container')?.classList.remove('sidebar-is-open');
    document.body.style.overflow = '';
}

function toggleMenu() {
    const cont = document.querySelector('.admin-container');
    if (!cont) return;
    if (cont.classList.contains('sidebar-is-open')) cerrarMenu();
    else abrirMenu();
}

let _vistaMovilAnterior = null;

function sincronizarMenuResponsive() {
    const cont = document.querySelector('.admin-container');
    if (!cont) return;

    const movil = esVistaMovil();

    if (_vistaMovilAnterior === null) {
        _vistaMovilAnterior = movil;
        if (movil) cont.classList.remove('sidebar-is-open');
        return;
    }

    if (movil === _vistaMovilAnterior) return;
    _vistaMovilAnterior = movil;
    document.body.style.overflow = '';

    if (movil) cont.classList.remove('sidebar-is-open');
    else cont.classList.add('sidebar-is-open');
}

// ============ NAVEGACIÓN ============
function mostrarSeccion(seccion) {
    document.querySelectorAll('.seccion-panel').forEach(el => el.classList.remove('activa'));
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    const nombre = seccion.charAt(0).toUpperCase() + seccion.slice(1);
    document.getElementById('seccion' + nombre)?.classList.add('activa');
    document.getElementById('menu'    + nombre)?.classList.add('active');

    if (esVistaMovil()) cerrarMenu();

    if (seccion === 'usuarios') cargarUsuarios();
    if (seccion === 'analisis') inicializarDashboard();
    if (seccion === 'candidatos' && esSuperadmin()) cargarCandidatos();
    if (seccion === 'dignidades' && esSuperadmin()) cargarEstadoDignidades();
    if (seccion === 'preguntas' && esSuperadmin()) cargarPreguntas();
    if (seccion === 'configuracion' && esSuperadmin()) { cargarEstadoAcceso(); cargarEstadoUbicacion(); cargarEstadoRespuestas(); }
    if (seccion === 'mapa') { setTimeout(() => cargarMapaVotos(), 200); }
    if (seccion === 'respuestas') { cargarRespuestas(); }
    if (seccion === 'analisisrespuestas') { cargarAnalisisRespuestas(); }
    if (seccion === 'analisisresultados') { cargarAnalisisResultados(); }
}

// ============ GESTIÓN DE USUARIOS ============
async function cargarUsuarios() {
    const tbody = document.getElementById('cuerpoTablaUsuarios');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">
        <i class="fas fa-circle-notch fa-spin"></i> Cargando usuarios...
    </td></tr>`;

    try {
        const rol = encodeURIComponent(getRolAdmin());
        const res  = await fetch(`${API_BASE_URL}/usuarios?rol_solicitante=${rol}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();

        let usuarios = data.usuarios || [];
        if (getRolAdmin() !== 'superadmin') {
            usuarios = usuarios.filter(u => u.rol !== 'superadmin');
        }

        if (!data.success || usuarios.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">
                No hay usuarios registrados
            </td></tr>`;
            return;
        }

        const miId = localStorage.getItem('idUsuario');
        tbody.innerHTML = usuarios.map((u, i) => {
            if (u.rol === 'superadmin' && !esSuperadmin()) return '';
            const fecha      = u.fecha_creacion
                ? new Date(u.fecha_creacion).toLocaleDateString('es-EC') : '—';
            const esMiCuenta = String(u.id) === String(miId);
            const btnEliminar = esMiCuenta
                ? `<span style="color:#94a3b8;font-size:0.8rem;font-style:italic;">Cuenta activa</span>`
                : `<button class="btn-eliminar" onclick="eliminarUsuario(${u.id}, '${u.usuario}')">
                       <i class="fas fa-trash-alt"></i> Eliminar
                   </button>`;
            return `<tr>
                <td style="color:#94a3b8;font-size:0.82rem;">${i + 1}</td>
                <td>
                    <strong style="color:#0f172a;">${u.usuario}</strong>
                    ${esMiCuenta
                        ? `<span style="font-size:0.72rem;color:#10b981;margin-left:6px;
                              background:#dcfce7;padding:2px 7px;border-radius:10px;">tú</span>`
                        : ''}
                </td>
                <td style="font-family:monospace;color:#475569;">${u.cedula || '—'}</td>
                <td><span class="badge-rol ${u.rol}">${u.rol}</span></td>
                <td style="color:#64748b;">${fecha}</td>
                <td>${btnEliminar}</td>
            </tr>`;
        }).join('');

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#ef4444;">
            <i class="fas fa-exclamation-circle"></i> Error de conexión
        </td></tr>`;
    }
}

async function eliminarUsuario(id, nombre) {
    if (!confirm(`¿Eliminar al usuario "${nombre}"?\n\nEsta acción no se puede deshacer.`)) return;
    try {
        const res  = await fetch(`${API_BASE_URL}/usuarios/${id}`, {
            method: 'DELETE',
            headers: getApiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ Usuario "${nombre}" eliminado.`);
            cargarUsuarios();
        } else {
            alert('❌ ' + (data.message || 'No se pudo eliminar'));
        }
    } catch (err) {
        alert('⚠️ Error de red al eliminar el usuario.');
    }
}

// ============ INICIALIZAR DASHBOARD ============
async function inicializarDashboard() {
    await cargarFiltroBarrios();
    await cargarFiltroCandidatos();
    await cargarTablaFija();
    await cargarEstadisticas();
    await cargarDesgloseCandidato();
}

// ============ TABLA FIJA (consolidado global) ============
async function cargarTablaFija() {
    try {
        const dignidad = encodeURIComponent(getDignidadActual());
        const res   = await fetch(`${API_BASE_URL}/estadisticas?zona=todas&dignidad=${dignidad}`, {
            headers: getApiHeaders()
        });
        const datos = await res.json();

        animarContador('totalVotosGlobal', datos.reduce((a, c) => a + c.total, 0));

        const elLider = document.getElementById('zonaLider');
        if (elLider) elLider.innerText = datos.length > 0 ? datos[0].candidato : '—';

        const cuerpoFijo = document.getElementById('cuerpoTablaFija');
        if (cuerpoFijo) {
            cuerpoFijo.innerHTML = datos.length === 0
                ? `<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px;">Sin votos</td></tr>`
                : datos.map((d, i) => `<tr>
                    <td>
                        ${i === 0
                            ? `<span style="color:#f59e0b;margin-right:5px;">🏆</span>`
                            : `<span style="color:#94a3b8;font-size:0.8rem;margin-right:8px;">${i + 1}.</span>`}
                        <strong>${d.candidato}</strong>
                    </td>
                    <td style="text-align:right;">
                        <span class="badge-votos">${d.total}</span>
                    </td>
                </tr>`).join('');
        }
    } catch (e) { console.error("Error tabla fija:", e); }
}

// ============ TABLA DINÁMICA (por zona) ============
async function cargarEstadisticas() {
    try {
        const filtro = document.getElementById('filtroZona');
        const zona   = filtro ? filtro.value : 'todas';
        const dignidad = encodeURIComponent(getDignidadActual());

        const tituloFiltro = document.getElementById('tituloFiltro');
        if (tituloFiltro) {
            const tituloZona = zona === 'todas' ? 'General' : zona;
            tituloFiltro.innerText = `${formatearDignidad(getDignidadActual())} · ${tituloZona}`;
        }

        const res   = await fetch(`${API_BASE_URL}/estadisticas?zona=${zona}&dignidad=${dignidad}`, {
            headers: getApiHeaders()
        });
        const datos = await res.json();
        const total = datos.reduce((a, c) => a + c.total, 0);

        const cuerpoDinamico = document.getElementById('cuerpoTablaDinamica');
        if (cuerpoDinamico) {
            cuerpoDinamico.innerHTML = datos.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px;">
                       Sin votos para esta zona
                   </td></tr>`
                : datos.map((d, i) => {
                    const pct = total > 0 ? ((d.total / total) * 100).toFixed(1) : 0;
                    const ancho = pct;
                    return `<tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="color:#94a3b8;font-size:0.78rem;min-width:16px;">${i + 1}</span>
                                <div style="flex:1;">
                                    <div style="font-weight:600;color:#0f172a;margin-bottom:4px;">
                                        ${d.candidato}
                                    </div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${ancho}%;height:100%;border-radius:20px;
                                            background:linear-gradient(90deg,#10b981,#059669);
                                            transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="width:80px;text-align:center;">
                            <span class="badge-votos">${d.total}</span>
                        </td>
                        <td style="width:60px;text-align:right;font-weight:700;color:#334155;">
                            ${pct}%
                        </td>
                    </tr>`;
                }).join('');
        }

        renderizarGrafico(datos.map(d => d.candidato), datos.map(d => d.total));

    } catch (error) { console.error("Error estadísticas:", error); }
}

// ============ CANDIDATOS - SELECTOR ============
async function cargarFiltroCandidatos() {
    try {
        const dignidad = encodeURIComponent(getDignidadActual());
        const res    = await fetch(`${API_BASE_URL}/candidatos-disponibles?dignidad=${dignidad}`, {
            headers: getApiHeaders()
        });
        const datos  = await res.json();
        const select = document.getElementById('filtroCandidato');
        if (!select) return;

        select.innerHTML = '';
        datos.forEach((c, i) => {
            const opt       = document.createElement('option');
            opt.value       = c.candidato;
            opt.textContent = c.candidato;
            if (i === 0) opt.selected = true;
            select.appendChild(opt);
        });
    } catch (e) { console.error("Error candidatos:", e); }
}

// ============ DESGLOSE POR CANDIDATO ============
async function cargarDesgloseCandidato() {
    try {
        const zona      = document.getElementById('filtroZona')?.value      || 'todas';
        const candidato = document.getElementById('filtroCandidato')?.value;
        const dignidad  = encodeURIComponent(getDignidadActual());

        const res  = await fetch(
            `${API_BASE_URL}/estadisticas-candidato?zona=${encodeURIComponent(zona)}&candidato=${encodeURIComponent(candidato)}&dignidad=${dignidad}`,
            { headers: getApiHeaders() }
        );
        const data = await res.json();

        const resumen = document.getElementById('resumenCandidato');
        if (resumen) {
            const label = candidato;
            resumen.style.display = 'block';
            resumen.innerHTML = `<i class="fas fa-vote-yea"></i>
                ${label}: <strong>${data.total}</strong> voto(s) registrado(s)`;
        }

        // Tabla género
        const tbGenero = document.getElementById('cuerpoGenerosCandidato');
        if (tbGenero) {
            const totalG = data.genero.reduce((a, c) => a + c.total, 0);
            tbGenero.innerHTML = data.genero.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:16px;">Sin datos</td></tr>`
                : data.genero.map(d => {
                    const pct   = totalG > 0 ? ((d.total / totalG) * 100).toFixed(1) : 0;
                    const icono = d.genero === 'Hombre' ? '👨' : '👩';
                    const color = d.genero === 'Hombre'
                        ? 'linear-gradient(90deg,#60a5fa,#2563eb)'
                        : 'linear-gradient(90deg,#f472b6,#db2777)';
                    return `<tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span>${icono}</span>
                                <div style="flex:1;">
                                    <div style="font-weight:600;margin-bottom:4px;">${d.genero}</div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${pct}%;height:100%;border-radius:20px;
                                            background:${color};transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                        <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                    </tr>`;
                }).join('');
        }

        // Tabla instruccion
        const tbInstruccion = document.getElementById('cuerpoInstruccionCandidato');
        if (tbInstruccion) {
            const totalI = data.instruccion.reduce((a, c) => a + c.total, 0);
            tbInstruccion.innerHTML = data.instruccion.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:16px;">Sin datos</td></tr>`
                : data.instruccion.map(d => {
                    const pct = totalI > 0 ? ((d.total / totalI) * 100).toFixed(1) : 0;
                    const iconos = { 'Primaria': '📘', 'Secundaria': '📗', 'Superior': '📕' };
                    return `<tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span>${iconos[d.nivel_instruccion] || '📄'}</span>
                                <div style="flex:1;">
                                    <div style="font-weight:600;margin-bottom:4px;">${d.nivel_instruccion}</div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${pct}%;height:100%;border-radius:20px;
                                            background:linear-gradient(90deg,#38bdf8,#0284c7);transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                        <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                    </tr>`;
                }).join('');
        }

        // Tabla ocupacion
        const tbOcupacion = document.getElementById('cuerpoOcupacionCandidato');
        if (tbOcupacion) {
            const totalO = data.ocupacion.reduce((a, c) => a + c.total, 0);
            tbOcupacion.innerHTML = data.ocupacion.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:16px;">Sin datos</td></tr>`
                : data.ocupacion.map(d => {
                    const pct = totalO > 0 ? ((d.total / totalO) * 100).toFixed(1) : 0;
                    const iconos = {
                        'Comerciante': '🛒', 'Agricultor': '🌾', 'Empleado público': '🏛️',
                        'Ama de casa': '🏠', 'Estudiante': '🎓', 'Otro': '🔧'
                    };
                    return `<tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span>${iconos[d.ocupacion] || '💼'}</span>
                                <div style="flex:1;">
                                    <div style="font-weight:600;margin-bottom:4px;">${d.ocupacion}</div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${pct}%;height:100%;border-radius:20px;
                                            background:linear-gradient(90deg,#a78bfa,#7c3aed);transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                        <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                    </tr>`;
                }).join('');
        }
        const tbEdad = document.getElementById('cuerpoEdadCandidato');
        if (tbEdad) {
            const config = {
                '18-25': { icono: '🧑', color: 'linear-gradient(90deg,#fbbf24,#d97706)' },
                '26-40': { icono: '👨', color: 'linear-gradient(90deg,#34d399,#059669)' },
                '+41':   { icono: '👴', color: 'linear-gradient(90deg,#a78bfa,#7c3aed)' }
            };
            const totalE  = data.edad.reduce((a, c) => a + c.total, 0);
            tbEdad.innerHTML = data.edad.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:16px;">Sin datos</td></tr>`
                : data.edad.map(d => {
                    const pct = totalE > 0 ? ((d.total / totalE) * 100).toFixed(1) : 0;
                    const cfg = config[d.rango_edad] || { icono: '👤', color: '#94a3b8' };
                    return `<tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span>${cfg.icono}</span>
                                <div style="flex:1;">
                                    <div style="font-weight:600;margin-bottom:4px;">${d.rango_edad} años</div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${pct}%;height:100%;border-radius:20px;
                                            background:${cfg.color};transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                        <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                    </tr>`;
                }).join('');
        }
    } catch (e) { console.error("Error desglose candidato:", e); }
}

// ============ FILTRO DE BARRIOS ============
async function cargarFiltroBarrios() {
    try {
        const dignidad = encodeURIComponent(getDignidadActual());
        const res    = await fetch(`${API_BASE_URL}/zonas-disponibles?dignidad=${dignidad}`, {
            headers: getApiHeaders()
        });
        const zonas  = await res.json();
        const select = document.getElementById('filtroZona');
        if (!select) return;

        select.innerHTML = '<option value="todas">Todas las Zonas</option>';
        zonas.forEach(z => {
            const opt       = document.createElement('option');
            opt.value       = z.zona;
            opt.textContent = z.zona;
            select.appendChild(opt);
        });
    } catch (e) { console.error("Error zonas:", e); }
}

// ============ GRÁFICO ============
function renderizarGrafico(labels, data) {
    const canvas = document.getElementById('graficoVotos');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (window.miGrafico) window.miGrafico.destroy();

    const coloresBase = [
        '#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899'
    ];

    const backgroundColors = data.map((_, i) => {
        const c = coloresBase[i % coloresBase.length];
        return c + 'cc';
    });
    const borderColors = data.map((_, i) => coloresBase[i % coloresBase.length]);

    window.miGrafico = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Votos',
                data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 10,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: ctx => `  ${ctx.parsed.y} votos`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Inter', size: 11 },
                        maxRotation: 30
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        precision: 0,
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 }
                    }
                }
            }
        }
    });
}

// ============ CONTADOR ANIMADO ============
function animarContador(id, valorFinal) {
    const el = document.getElementById(id);
    if (!el) return;
    let inicio = 0;
    const duracion  = 800;
    const pasos     = 60;
    const intervalo = duracion / pasos;
    const incremento = valorFinal / pasos;

    const timer = setInterval(() => {
        inicio += incremento;
        if (inicio >= valorFinal) {
            el.innerText = valorFinal;
            clearInterval(timer);
        } else {
            el.innerText = Math.floor(inicio);
        }
    }, intervalo);
}

// ============ AUTO-REFRESH INDICADOR ============
function actualizarRelojRefresh() {
    const btn = document.querySelector('.btn-refresh-data');
    if (!btn) return;

    let segundos = 30;
    if (window._refreshTimer) clearInterval(window._refreshTimer);

    btn.innerHTML = `<i class="fas fa-sync"></i> Actualizar (${segundos}s)`;

    window._refreshTimer = setInterval(() => {
        segundos--;
        if (segundos <= 0) {
            clearInterval(window._refreshTimer);
            btn.innerHTML = `<i class="fas fa-sync fa-spin"></i> Actualizando...`;
        } else {
            btn.innerHTML = `<i class="fas fa-sync"></i> Actualizar (${segundos}s)`;
        }
    }, 1000);
}

// ============ DESCARGA EXCEL ============
async function descargarExcelDignidades() {
    if (!confirm("¿Descargar Excel de votos de dignidades?")) return;

    const btn = document.getElementById('btnDescargarExcel');
    if (btn) {
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generando...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/descargar-excel-dignidades`, {
            headers: getApiHeaders()
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 404) { alert(err.error || 'No hay datos para exportar'); return; }
            throw new Error(err.error || 'Error del servidor');
        }

        const blob  = await res.blob();
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = `Votos_Dignidades_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('❌ ' + (err.message || 'Error al descargar'));
        console.error(err);
    } finally {
        if (btn) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-file-excel"></i> <span>Excel Dignidades</span>';
        }
    }
}

async function descargarExcelPreguntas() {
    if (!confirm("¿Descargar Excel de respuestas a preguntas?")) return;

    const btn = document.getElementById('btnDescargarExcelPreguntas');
    if (btn) {
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generando...';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/descargar-excel-preguntas`, {
            headers: getApiHeaders()
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 404) { alert(err.error || 'No hay datos para exportar'); return; }
            throw new Error(err.error || 'Error del servidor');
        }

        const blob  = await res.blob();
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = `Respuestas_Preguntas_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('❌ ' + (err.message || 'Error al descargar'));
        console.error(err);
    } finally {
        if (btn) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-file-excel"></i> <span>Excel Preguntas</span>';
        }
    }
}

// ============ CANDIDATOS CRUD ============

async function cargarCandidatos() {
    const tbody = document.getElementById('cuerpoTablaCandidatos');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;"><i class="fas fa-circle-notch fa-spin"></i> Cargando candidatos...</td></tr>';

    const dignidad = document.getElementById('filtroCandidatosDignidad')?.value || 'ALCALDE';
    try {
        const res = await fetch(`${API_BASE_URL}/candidatos?dignidad=${encodeURIComponent(dignidad)}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        tbody.innerHTML = data.candidatos.length
            ? data.candidatos.map(c => {
                const fotoUrl = `${API_BASE_URL}/encuesta/assets/candidatos/${encodeURIComponent(c.foto)}`;
                return `<tr>
                    <td><img src="${fotoUrl}" class="candidato-foto-thumb" onerror="this.src='${API_BASE_URL}/encuesta/assets/candidatos/placeholder-candidato.svg'"></td>
                    <td><strong>${c.nombre}</strong></td>
                    <td>${c.dignidad}</td>
                    <td>${c.zona || '—'}</td>
                    <td>${c.orden}</td>
                    <td>
                        <button class="btn-editar" onclick="editarCandidato(${c.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-eliminar" onclick="eliminarCandidato(${c.id},'${c.nombre}')"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">No hay candidatos para esta dignidad</td></tr>';
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#ef4444;">Error de conexión</td></tr>';
    }
}

function mostrarFormCandidato(candidato) {
    const container = document.getElementById('candidatoFormContainer');
    const title = document.getElementById('candidatoFormTitle');
    const form = document.getElementById('candidatoForm');
    container.style.display = 'block';
    title.innerHTML = '<i class="fas fa-user-plus"></i> Nuevo Candidato';
    document.getElementById('editCandidatoId').value = '';
    document.getElementById('candidatoNombre').value = candidato?.nombre || '';
    document.getElementById('candidatoDignidad').value = candidato?.dignidad || document.getElementById('filtroCandidatosDignidad')?.value || 'ALCALDE';
    document.getElementById('candidatoZona').value = candidato?.zona || '';
    document.getElementById('candidatoOrden').value = candidato?.orden || 0;
    document.getElementById('candidatoFoto').value = '';
    document.getElementById('fotoPreview').style.display = 'none';
    form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('dignidad', document.getElementById('candidatoDignidad').value);
        fd.append('nombre', document.getElementById('candidatoNombre').value.trim());
        fd.append('zona', document.getElementById('candidatoZona').value.trim());
        fd.append('orden', document.getElementById('candidatoOrden').value);
        const foto = document.getElementById('candidatoFoto').files[0];
        if (foto) fd.append('foto', foto);
        const editId = document.getElementById('editCandidatoId').value;
        const url = editId ? `${API_BASE_URL}/candidatos/${editId}` : `${API_BASE_URL}/candidatos`;
        const method = editId ? 'PUT' : 'POST';
        try {
            const res = await fetch(url, {
                method,
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'ngrok-skip-browser-warning': 'true' },
                body: fd
            });
            const data = await res.json();
            if (data.success) {
                alert(editId ? '✅ Candidato actualizado' : '✅ Candidato creado');
                cancelarFormCandidato();
                await cargarCandidatos();
            } else {
                alert('❌ ' + (data.message || 'Error'));
            }
        } catch (err) {
            alert('⚠️ Error de conexión');
        }
    };
}

function cancelarFormCandidato() {
    document.getElementById('candidatoFormContainer').style.display = 'none';
    document.getElementById('candidatoForm').onsubmit = null;
}

async function editarCandidato(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/candidatos?dignidad=todas`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        const c = data.candidatos.find(x => x.id === id);
        if (!c) { alert('Candidato no encontrado'); return; }
        const container = document.getElementById('candidatoFormContainer');
        const title = document.getElementById('candidatoFormTitle');
        container.style.display = 'block';
        title.innerHTML = '<i class="fas fa-edit"></i> Editar Candidato';
        document.getElementById('editCandidatoId').value = c.id;
        document.getElementById('candidatoNombre').value = c.nombre;
        document.getElementById('candidatoDignidad').value = c.dignidad;
        document.getElementById('candidatoZona').value = c.zona || '';
        document.getElementById('candidatoOrden').value = c.orden;
        document.getElementById('candidatoFoto').value = '';
        const preview = document.getElementById('fotoPreview');
        const previewImg = document.getElementById('fotoPreviewImg');
        if (c.foto && c.foto !== 'placeholder-candidato.svg') {
            previewImg.src = `${API_BASE_URL}/encuesta/assets/candidatos/${encodeURIComponent(c.foto)}`;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
        document.getElementById('candidatoForm').onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData();
            fd.append('dignidad', document.getElementById('candidatoDignidad').value);
            fd.append('nombre', document.getElementById('candidatoNombre').value.trim());
            fd.append('zona', document.getElementById('candidatoZona').value.trim());
            fd.append('orden', document.getElementById('candidatoOrden').value);
            const foto = document.getElementById('candidatoFoto').files[0];
            if (foto) fd.append('foto', foto);
            try {
                const res = await fetch(`${API_BASE_URL}/candidatos/${c.id}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'ngrok-skip-browser-warning': 'true' },
                    body: fd
                });
                const data = await res.json();
                if (data.success) {
                    alert('✅ Candidato actualizado');
                    cancelarFormCandidato();
                    await cargarCandidatos();
                } else {
                    alert('❌ ' + (data.message || 'Error'));
                }
            } catch (err) {
                alert('⚠️ Error de conexión');
            }
        };
    } catch (err) {
        alert('⚠️ Error al cargar candidato');
    }
}

async function eliminarCandidato(id, nombre) {
    if (!confirm(`¿Eliminar a "${nombre}"?`)) return;
    try {
        const res = await fetch(`${API_BASE_URL}/candidatos/${id}`, {
            method: 'DELETE',
            headers: getApiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ Candidato eliminado');
            await cargarCandidatos();
        } else {
            alert('❌ ' + (data.message || 'Error'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión');
    }
}

// ============ PREGUNTAS CRUD ============

async function cargarPreguntas() {
    const tbody = document.getElementById('cuerpoTablaPreguntas');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8;"><i class="fas fa-circle-notch fa-spin"></i> Cargando preguntas...</td></tr>';

    try {
        const res = await fetch(`${API_BASE_URL}/preguntas`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        tbody.innerHTML = data.preguntas.length
            ? data.preguntas.map((p, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${p.pregunta}</strong></td>
                    <td>${p.activa ? '<span style="color:#059669;font-weight:600;">Activa</span>' : '<span style="color:#94a3b8;">Inactiva</span>'}</td>
                    <td>${p.orden}</td>
                    <td>
                        <button class="btn-editar" onclick="editarPregunta(${p.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn-eliminar" onclick="eliminarPregunta(${p.id})"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8;">No hay preguntas registradas</td></tr>';
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#ef4444;">Error de conexión</td></tr>';
    }
}

function mostrarFormPregunta(pregunta) {
    const container = document.getElementById('preguntaFormContainer');
    const title = document.getElementById('preguntaFormTitle');
    const form = document.getElementById('preguntaForm');
    container.style.display = 'block';
    title.innerHTML = '<i class="fas fa-plus-circle"></i> Nueva Pregunta';
    document.getElementById('editPreguntaId').value = '';
    document.getElementById('preguntaTexto').value = pregunta?.pregunta || '';
    document.getElementById('preguntaActiva').checked = pregunta ? pregunta.activa : true;
    document.getElementById('preguntaOrden').value = pregunta?.orden || 0;
    form.onsubmit = async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editPreguntaId').value;
        const payload = {
            pregunta: document.getElementById('preguntaTexto').value.trim(),
            activa: document.getElementById('preguntaActiva').checked,
            orden: parseInt(document.getElementById('preguntaOrden').value) || 0
        };
        const url = editId ? `${API_BASE_URL}/preguntas/${editId}` : `${API_BASE_URL}/preguntas`;
        const method = editId ? 'PUT' : 'POST';
        try {
            const res = await fetch(url, {
                method,
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                alert(editId ? '✅ Pregunta actualizada' : '✅ Pregunta creada');
                cancelarFormPregunta();
                await cargarPreguntas();
            } else {
                alert('❌ ' + (data.message || 'Error'));
            }
        } catch (err) {
            alert('⚠️ Error de conexión');
        }
    };
}

function cancelarFormPregunta() {
    document.getElementById('preguntaFormContainer').style.display = 'none';
    document.getElementById('preguntaForm').onsubmit = null;
}

async function editarPregunta(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/preguntas`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        const p = data.preguntas.find(x => x.id === id);
        if (!p) { alert('Pregunta no encontrada'); return; }
        mostrarFormPregunta(p);
        document.getElementById('editPreguntaId').value = p.id;
        document.getElementById('preguntaFormTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Pregunta';
    } catch (err) {
        alert('⚠️ Error al cargar pregunta');
    }
}

async function eliminarPregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/preguntas/${id}`, {
            method: 'DELETE',
            headers: getApiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ Pregunta eliminada');
            await cargarPreguntas();
        } else {
            alert('❌ ' + (data.message || 'Error'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión');
    }
}

// ============ RESPUESTAS DE PREGUNTAS ============

async function cargarFiltroZonaRespuestas() {
    const select = document.getElementById('filtroRespuestasZona');
    if (!select) return;
    try {
        const res = await fetch(`${API_BASE_URL}/zonas-disponibles?dignidad=PREGUNTAS`, {
            headers: getApiHeaders()
        });
        const zonas = await res.json();
        select.innerHTML = '<option value="todas">Todas las Zonas</option>';
        zonas.forEach(z => {
            const opt = document.createElement('option');
            opt.value = z.zona;
            opt.textContent = z.zona;
            select.appendChild(opt);
        });
    } catch (e) { console.error("Error zonas respuestas:", e); }
}

async function cargarRespuestas() {
    const container = document.getElementById('respuestasContainer');
    if (!container) return;

    await cargarFiltroZonaRespuestas();
    const zona = document.getElementById('filtroRespuestasZona')?.value || 'todas';

    try {
        const res = await fetch(`${API_BASE_URL}/estadisticas-preguntas?zona=${encodeURIComponent(zona)}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        const preguntas = data.preguntas || [];
        const totalPersonas = data.total_personas || 0;

        if (preguntas.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-inbox"></i> No hay respuestas registradas</div>';
            return;
        }

        container.innerHTML = `
            <div style="background:#e0f2fe;border:1px solid #7dd3fc;border-radius:10px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-users" style="color:#0284c7;font-size:1.2rem;"></i>
                <span style="font-weight:700;color:#0369a1;font-size:0.95rem;">
                    Total de personas encuestadas: ${totalPersonas}
                </span>
            </div>

            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;">
                <div style="flex:1;min-width:280px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;">
                    <h4 style="margin:0 0 10px 0;font-size:0.85rem;color:#92400e;">
                        <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> Principal problema del barrio
                    </h4>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${(data.problemas || []).map(p => {
                            const pct = totalPersonas > 0 ? ((p.total / totalPersonas) * 100).toFixed(1) : 0;
                            return `<div style="display:flex;align-items:center;gap:8px;font-size:0.83rem;">
                                <span style="font-weight:600;color:#334155;min-width:100px;">${p.problema_principal}</span>
                                <div style="flex:1;background:#fef3c7;border-radius:20px;height:8px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;background:linear-gradient(90deg,#f59e0b,#d97706);transition:width 0.8s ease;"></div>
                                </div>
                                <span style="font-weight:700;color:#92400e;min-width:50px;text-align:right;">${p.total} (${pct}%)</span>
                            </div>`;
                        }).join('') || '<span style="color:#94a3b8;font-size:0.83rem;">Sin datos</span>'}
                    </div>
                </div>
                <div style="flex:1;min-width:280px;background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:14px 18px;">
                    <h4 style="margin:0 0 10px 0;font-size:0.85rem;color:#1e40af;">
                        <i class="fas fa-broadcast-tower" style="color:#38bdf8;"></i> Medio de información preferido
                    </h4>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${(data.medios || []).map(m => {
                            const pct = totalPersonas > 0 ? ((m.total / totalPersonas) * 100).toFixed(1) : 0;
                            return `<div style="display:flex;align-items:center;gap:8px;font-size:0.83rem;">
                                <span style="font-weight:600;color:#334155;min-width:120px;">${m.medio_informacion}</span>
                                <div style="flex:1;background:#dbeafe;border-radius:20px;height:8px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;background:linear-gradient(90deg,#3b82f6,#1d4ed8);transition:width 0.8s ease;"></div>
                                </div>
                                <span style="font-weight:700;color:#1e40af;min-width:50px;text-align:right;">${m.total} (${pct}%)</span>
                            </div>`;
                        }).join('') || '<span style="color:#94a3b8;font-size:0.83rem;">Sin datos</span>'}
                    </div>
                </div>
            </div>
        ` + preguntas.map((p, i) => {
            const personas = p.personas || 0;

            const opciones = [
                { key: 'muy_de_acuerdo', label: 'Muy de acuerdo', color: '#22c55e', bg: '#f0fdf4' },
                { key: 'de_acuerdo', label: 'De acuerdo', color: '#86efac', bg: '#f0fdf4' },
                { key: 'indiferente', label: 'Indiferente', color: '#94a3b8', bg: '#f8fafc' },
                { key: 'en_desacuerdo', label: 'En desacuerdo', color: '#fca5a5', bg: '#fef2f2' },
                { key: 'totalmente_en_desacuerdo', label: 'Totalmente en desacuerdo', color: '#ef4444', bg: '#fef2f2' }
            ];

            const generoRows = (p.genero || []).map(g => {
                const pct = personas > 0 ? ((g.total / personas) * 100).toFixed(1) : 0;
                const icono = g.genero === 'Hombre' ? '👨' : '👩';
                return `<tr>
                    <td><span style="font-weight:600;">${icono} ${g.genero}</span></td>
                    <td style="text-align:center;"><span class="badge-votos">${g.total}</span></td>
                    <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                </tr>`;
            }).join('');

            const edadRows = (p.edad || []).map(e => {
                const pct = personas > 0 ? ((e.total / personas) * 100).toFixed(1) : 0;
                return `<tr>
                    <td><span style="font-weight:600;">${e.rango_edad} años</span></td>
                    <td style="text-align:center;"><span class="badge-votos">${e.total}</span></td>
                    <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                </tr>`;
            }).join('');

            const instruccionRows = (p.instruccion || []).map(d => {
                const pct = personas > 0 ? ((d.total / personas) * 100).toFixed(1) : 0;
                const iconos = { 'Primaria': '📘', 'Secundaria': '📗', 'Superior': '📕' };
                return `<tr>
                    <td><span style="font-weight:600;">${iconos[d.nivel_instruccion] || '📄'} ${d.nivel_instruccion}</span></td>
                    <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                    <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                </tr>`;
            }).join('');

            const ocupacionRows = (p.ocupacion || []).map(d => {
                const pct = personas > 0 ? ((d.total / personas) * 100).toFixed(1) : 0;
                const iconos = { 'Comerciante': '🛒', 'Agricultor': '🌾', 'Empleado público': '🏛️', 'Ama de casa': '🏠', 'Estudiante': '🎓', 'Otro': '🔧' };
                return `<tr>
                    <td><span style="font-weight:600;">${iconos[d.ocupacion] || '💼'} ${d.ocupacion}</span></td>
                    <td style="text-align:center;"><span class="badge-votos">${d.total}</span></td>
                    <td style="text-align:right;font-weight:700;color:#334155;">${pct}%</td>
                </tr>`;
            }).join('');

            return `
                <div class="pregunta-resultado" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                        <h3 style="margin:0;font-size:1rem;color:#0f172a;flex:1;">
                            <span style="color:#94a3b8;margin-right:8px;">${i + 1}.</span>
                            ${p.pregunta}
                        </h3>
                        <span style="background:#e2e8f0;color:#475569;padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:600;white-space:nowrap;margin-left:12px;">
                            ${personas} persona(s)
                        </span>
                    </div>

                    </div>

                    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                        ${opciones.map(o => {
                            const valor = p[o.key] || 0;
                            const pct = personas > 0 ? ((valor / personas) * 100).toFixed(1) : 0;
                            return `<div style="flex:1;min-width:140px;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                                    <span style="font-weight:600;color:#334155;font-size:0.78rem;">${o.label}</span>
                                    <span style="font-weight:700;color:#334155;font-size:0.83rem;">${valor} (${pct}%)</span>
                                </div>
                                <div style="background:#e2e8f0;border-radius:20px;height:8px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;
                                        background:${o.color};transition:width 0.8s ease;"></div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>

                    <div style="display:flex;gap:20px;flex-wrap:wrap;border-top:1px solid #e2e8f0;padding-top:14px;">
                        <div style="flex:1;min-width:180px;">
                            <h4 style="margin:0 0 8px 0;font-size:0.85rem;color:#64748b;">
                                <i class="fas fa-venus-mars"></i> Por género
                            </h4>
                            <table style="width:100%;border-collapse:collapse;font-size:0.83rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:6px 10px;text-align:left;color:#475569;">Género</th>
                                        <th style="padding:6px 10px;text-align:center;color:#475569;">Votos</th>
                                        <th style="padding:6px 10px;text-align:right;color:#475569;">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${generoRows || '<tr><td colspan="3" style="text-align:center;padding:10px;color:#94a3b8;">Sin datos</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <h4 style="margin:0 0 8px 0;font-size:0.85rem;color:#64748b;">
                                <i class="fas fa-calendar-alt"></i> Por edad
                            </h4>
                            <table style="width:100%;border-collapse:collapse;font-size:0.83rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:6px 10px;text-align:left;color:#475569;">Edad</th>
                                        <th style="padding:6px 10px;text-align:center;color:#475569;">Votos</th>
                                        <th style="padding:6px 10px;text-align:right;color:#475569;">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${edadRows || '<tr><td colspan="3" style="text-align:center;padding:10px;color:#94a3b8;">Sin datos</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <h4 style="margin:0 0 8px 0;font-size:0.85rem;color:#64748b;">
                                <i class="fas fa-graduation-cap"></i> Por instrucción
                            </h4>
                            <table style="width:100%;border-collapse:collapse;font-size:0.83rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:6px 10px;text-align:left;color:#475569;">Nivel</th>
                                        <th style="padding:6px 10px;text-align:center;color:#475569;">Votos</th>
                                        <th style="padding:6px 10px;text-align:right;color:#475569;">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${instruccionRows || '<tr><td colspan="3" style="text-align:center;padding:10px;color:#94a3b8;">Sin datos</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <h4 style="margin:0 0 8px 0;font-size:0.85rem;color:#64748b;">
                                <i class="fas fa-briefcase"></i> Por ocupación
                            </h4>
                            <table style="width:100%;border-collapse:collapse;font-size:0.83rem;">
                                <thead>
                                    <tr style="background:#f1f5f9;">
                                        <th style="padding:6px 10px;text-align:left;color:#475569;">Ocupación</th>
                                        <th style="padding:6px 10px;text-align:center;color:#475569;">Votos</th>
                                        <th style="padding:6px 10px;text-align:right;color:#475569;">%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${ocupacionRows || '<tr><td colspan="3" style="text-align:center;padding:10px;color:#94a3b8;">Sin datos</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Error al cargar respuestas</div>';
    }
}

// ============ ANÁLISIS DE RESPUESTAS ============

async function cargarAnalisisRespuestas() {
    const container = document.getElementById('analisisRespuestasContainer');
    if (!container) return;

    await cargarFiltroZonaAnalisisRespuestas();
    const zona = document.getElementById('filtroAnalisisRespuestasZona')?.value || 'todas';

    try {
        const res = await fetch(`${API_BASE_URL}/estadisticas-preguntas?zona=${encodeURIComponent(zona)}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        const preguntas = data.preguntas || [];
        const totalPersonas = data.total_personas || 0;

        if (preguntas.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-inbox"></i> No hay respuestas registradas</div>';
            return;
        }

        // Calcular puntaje de sentimiento por pregunta (promedio ponderado: muy_de_acuerdo=+2, de_acuerdo=+1, indiferente=0, en_desacuerdo=-1, totalmente_en_desacuerdo=-2)
        const preguntasConScore = preguntas.map(p => {
            const total = p.personas || 0;
            const acuerdo = p.muy_de_acuerdo || 0;
            const deAcuerdo = p.de_acuerdo || 0;
            const indiferente = p.indiferente || 0;
            const desacuerdo = p.en_desacuerdo || 0;
            const totalDesacuerdo = p.totalmente_en_desacuerdo || 0;
            const sumaPonderada = (acuerdo * 2) + deAcuerdo + (desacuerdo * -1) + (totalDesacuerdo * -2);
            const score = total > 0 ? (sumaPonderada / total) : 0;
            const pctAcuerdo = total > 0 ? (((acuerdo + deAcuerdo) / total) * 100).toFixed(1) : 0;
            const pctDesacuerdo = total > 0 ? (((desacuerdo + totalDesacuerdo) / total) * 100).toFixed(1) : 0;
            return { ...p, score, pctAcuerdo, pctDesacuerdo, total };
        });

        // Pregunta con mayor acuerdo
        const sortedAcuerdo = [...preguntasConScore].sort((a, b) => b.pctAcuerdo - a.pctAcuerdo);
        const topAcuerdo = sortedAcuerdo[0];
        const topDesacuerdo = [...preguntasConScore].sort((a, b) => b.pctDesacuerdo - a.pctDesacuerdo)[0];
        const promedioGlobal = preguntasConScore.reduce((s, p) => s + p.score, 0) / preguntasConScore.length;

        function labelScore(score) {
            if (score > 1) return 'Muy positivo';
            if (score > 0.3) return 'Positivo';
            if (score > -0.3) return 'Neutral';
            if (score > -1) return 'Negativo';
            return 'Muy negativo';
        }

        function colorScore(score) {
            if (score > 1) return '#22c55e';
            if (score > 0.3) return '#86efac';
            if (score > -0.3) return '#94a3b8';
            if (score > -1) return '#fca5a5';
            return '#ef4444';
        }

        container.innerHTML = `
            <div style="background:#e0f2fe;border:1px solid #7dd3fc;border-radius:10px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-users" style="color:#0284c7;font-size:1.2rem;"></i>
                <span style="font-weight:700;color:#0369a1;font-size:0.95rem;">
                    Total de personas encuestadas: ${totalPersonas}
                </span>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
                <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">PREGUNTAS</div>
                    <div style="font-size:1.8rem;font-weight:800;color:#0f172a;">${preguntas.length}</div>
                    <div style="font-size:0.78rem;color:#64748b;">totales</div>
                </div>
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">MAYOR ACUERDO</div>
                    <div style="font-size:1.1rem;font-weight:800;color:#0f172a;line-height:1.3;">${topAcuerdo.pregunta}</div>
                    <div style="font-size:0.95rem;font-weight:700;color:#059669;">${topAcuerdo.pctAcuerdo}%</div>
                </div>
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">MAYOR DESACUERDO</div>
                    <div style="font-size:1.1rem;font-weight:800;color:#0f172a;line-height:1.3;">${topDesacuerdo.pregunta}</div>
                    <div style="font-size:0.95rem;font-weight:700;color:#dc2626;">${topDesacuerdo.pctDesacuerdo}%</div>
                </div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">SENTIMIENTO GLOBAL</div>
                    <div style="font-size:1.3rem;font-weight:800;color:${colorScore(promedioGlobal)};">${promedioGlobal.toFixed(2)}</div>
                    <div style="font-size:0.78rem;font-weight:600;color:${colorScore(promedioGlobal)};">${labelScore(promedioGlobal)}</div>
                </div>
            </div>

            <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:20px;">
                <div style="flex:1;min-width:280px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;">
                    <h4 style="margin:0 0 10px 0;font-size:0.85rem;color:#92400e;">
                        <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> Principal problema del barrio
                    </h4>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${(data.problemas || []).map(p => {
                            const pct = totalPersonas > 0 ? ((p.total / totalPersonas) * 100).toFixed(1) : 0;
                            return `<div style="display:flex;align-items:center;gap:8px;font-size:0.83rem;">
                                <span style="font-weight:600;color:#334155;min-width:100px;">${p.problema_principal}</span>
                                <div style="flex:1;background:#fef3c7;border-radius:20px;height:8px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;background:linear-gradient(90deg,#f59e0b,#d97706);transition:width 0.8s ease;"></div>
                                </div>
                                <span style="font-weight:700;color:#92400e;min-width:50px;text-align:right;">${p.total} (${pct}%)</span>
                            </div>`;
                        }).join('') || '<span style="color:#94a3b8;font-size:0.83rem;">Sin datos</span>'}
                    </div>
                </div>
                <div style="flex:1;min-width:280px;background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:14px 18px;">
                    <h4 style="margin:0 0 10px 0;font-size:0.85rem;color:#1e40af;">
                        <i class="fas fa-broadcast-tower" style="color:#38bdf8;"></i> Medio de información preferido
                    </h4>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${(data.medios || []).map(m => {
                            const pct = totalPersonas > 0 ? ((m.total / totalPersonas) * 100).toFixed(1) : 0;
                            return `<div style="display:flex;align-items:center;gap:8px;font-size:0.83rem;">
                                <span style="font-weight:600;color:#334155;min-width:120px;">${m.medio_informacion}</span>
                                <div style="flex:1;background:#dbeafe;border-radius:20px;height:8px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;background:linear-gradient(90deg,#3b82f6,#1d4ed8);transition:width 0.8s ease;"></div>
                                </div>
                                <span style="font-weight:700;color:#1e40af;min-width:50px;text-align:right;">${m.total} (${pct}%)</span>
                            </div>`;
                        }).join('') || '<span style="color:#94a3b8;font-size:0.83rem;">Sin datos</span>'}
                    </div>
                </div>
            </div>

            ${preguntasConScore.map((p, i) => {
                const acuerdo = p.muy_de_acuerdo || 0;
                const deAcuerdo = p.de_acuerdo || 0;
                const indiferente = p.indiferente || 0;
                const desacuerdo = p.en_desacuerdo || 0;
                const totalDesacuerdo = p.totalmente_en_desacuerdo || 0;
                const total = p.total;

                const pcts = [
                    { label: 'Muy de acuerdo', valor: acuerdo, pct: total > 0 ? (acuerdo / total * 100) : 0, color: '#22c55e' },
                    { label: 'De acuerdo', valor: deAcuerdo, pct: total > 0 ? (deAcuerdo / total * 100) : 0, color: '#86efac' },
                    { label: 'Indiferente', valor: indiferente, pct: total > 0 ? (indiferente / total * 100) : 0, color: '#94a3b8' },
                    { label: 'En desacuerdo', valor: desacuerdo, pct: total > 0 ? (desacuerdo / total * 100) : 0, color: '#fca5a5' },
                    { label: 'Totalmente en desacuerdo', valor: totalDesacuerdo, pct: total > 0 ? (totalDesacuerdo / total * 100) : 0, color: '#ef4444' }
                ];

                const barraAcuerdo = pcts.slice(0, 2);
                const barraIndiferente = pcts.slice(2, 3);
                const barraDesacuerdo = pcts.slice(3);
                const totalBarPct = barraAcuerdo.reduce((s, b) => s + b.pct, 0) + barraIndiferente.reduce((s, b) => s + b.pct, 0) + barraDesacuerdo.reduce((s, b) => s + b.pct, 0);

                return `
                    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                            <h3 style="margin:0;font-size:0.95rem;color:#0f172a;flex:1;line-height:1.4;">
                                <span style="color:#94a3b8;margin-right:8px;">${i + 1}.</span>
                                ${p.pregunta}
                            </h3>
                            <div style="text-align:right;margin-left:12px;">
                                <span style="background:#e2e8f0;color:#475569;padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:600;white-space:nowrap;">
                                    ${total} persona(s)
                                </span>
                            </div>
                        </div>

                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                            ${pcts.map(o => `
                                <div style="flex:1;min-width:110px;">
                                    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                                        <span style="font-weight:600;color:#334155;font-size:0.73rem;">${o.label}</span>
                                        <span style="font-weight:700;color:#334155;font-size:0.8rem;">${o.valor} (${o.pct.toFixed(1)}%)</span>
                                    </div>
                                    <div style="background:#e2e8f0;border-radius:20px;height:6px;overflow:hidden;">
                                        <div style="width:${o.pct}%;height:100%;border-radius:20px;background:${o.color};transition:width 0.8s ease;"></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>

                        <div style="background:#f1f5f9;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
                            <div style="display:flex;gap:0;height:28px;border-radius:6px;overflow:hidden;">
                                ${barraAcuerdo.map(b => b.pct > 0 ? `<div style="width:${b.pct}%;background:${b.color};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:white;min-width:${b.pct > 5 ? '30px' : '0'};transition:width 0.8s ease;">${b.pct > 5 ? `${b.pct.toFixed(0)}%` : ''}</div>` : '').join('')}
                                ${barraIndiferente.map(b => b.pct > 0 ? `<div style="width:${b.pct}%;background:${b.color};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:white;min-width:${b.pct > 5 ? '30px' : '0'};transition:width 0.8s ease;">${b.pct > 5 ? `${b.pct.toFixed(0)}%` : ''}</div>` : '').join('')}
                                ${barraDesacuerdo.map(b => b.pct > 0 ? `<div style="width:${b.pct}%;background:${b.color};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:white;min-width:${b.pct > 5 ? '30px' : '0'};transition:width 0.8s ease;">${b.pct > 5 ? `${b.pct.toFixed(0)}%` : ''}</div>` : '').join('')}
                            </div>
                            <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:#64748b;margin-top:4px;">
                                <span>👍 Acuerdo: ${p.pctAcuerdo}%</span>
                                <span>➖ Indiferente: ${total > 0 ? ((indiferente / total) * 100).toFixed(1) : 0}%</span>
                                <span>👎 Desacuerdo: ${p.pctDesacuerdo}%</span>
                            </div>
                        </div>

                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <div style="display:flex;align-items:center;gap:6px;background:${colorScore(p.score)}15;padding:6px 12px;border-radius:8px;">
                                <span style="font-size:0.78rem;color:#64748b;">Sentimiento:</span>
                                <span style="font-weight:700;font-size:0.9rem;color:${colorScore(p.score)};">${p.score.toFixed(2)}</span>
                                <span style="font-size:0.72rem;font-weight:600;color:${colorScore(p.score)};">(${labelScore(p.score)})</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;background:#f1f5f9;padding:6px 12px;border-radius:8px;">
                                <span style="font-size:0.78rem;color:#64748b;">Moda:</span>
                                <span style="font-weight:700;font-size:0.85rem;color:#334155;">${pcts.reduce((a, b) => a.valor > b.valor ? a : b).label}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    } catch (err) {
        console.error('Error cargando análisis:', err);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Error al cargar análisis</div>';
    }
}

async function cargarFiltroZonaAnalisisRespuestas() {
    try {
        const res = await fetch(`${API_BASE_URL}/zonas-disponibles?dignidad=PREGUNTAS`, {
            headers: getApiHeaders()
        });
        const zonas = await res.json();
        const select = document.getElementById('filtroAnalisisRespuestasZona');
        if (!select) return;
        const actual = select.value;
        select.innerHTML = '<option value="todas">Todas las Zonas</option>';
        if (Array.isArray(zonas)) {
            zonas.forEach(z => {
                const opt = document.createElement('option');
                opt.value = z.zona;
                opt.textContent = z.zona;
                select.appendChild(opt);
            });
        }
        if (actual) select.value = actual;
    } catch (err) {
        console.warn('Error cargando zonas para análisis:', err.message);
    }
}

// ============ ANÁLISIS DE RESULTADOS (VOTACIONES) ============

async function cargarAnalisisResultados() {
    const container = document.getElementById('analisisResultadosContainer');
    if (!container) return;

    await cargarFiltroAnalisisDignidad();
    await cargarFiltroZonaAnalisisResultados();
    const dignidad = document.getElementById('filtroAnalisisDignidad')?.value || 'todas';
    const zona = document.getElementById('filtroAnalisisZona')?.value || 'todas';

    try {
        const params = new URLSearchParams({ dignidad, zona });
        const res = await fetch(`${API_BASE_URL}/analisis-resultados?${params}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        const totalVotos = data.total_votos || 0;
        const candidatos = data.candidatos || [];
        const dominancia = data.dominancia || {};
        const perfiles = data.candidato_perfiles || {};
        const dignidadRes = data.dignidad_res || [];

        if (candidatos.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-inbox"></i> No hay votos registrados</div>';
            return;
        }

        function topDeGrupo(grupo, keyLabel) {
            const map = {};
            for (const item of grupo) {
                const key = item[keyLabel];
                if (!map[key] || item.total > map[key].total) map[key] = item;
            }
            return Object.values(map);
        }

        function perfilParaTabla(perfil, total) {
            const rows = [];
            const cols = [
                { data: perfil.genero, label: 'Género', sub: 'genero' },
                { data: perfil.edad, label: 'Edad', sub: 'rango_edad' },
                { data: perfil.instruccion, label: 'Instrucción', sub: 'nivel_instruccion' },
                { data: perfil.ocupacion, label: 'Ocupación', sub: 'ocupacion' }
            ];
            for (const c of cols) {
                for (const d of (c.data || [])) {
                    const pct = total > 0 ? ((d.total / total) * 100).toFixed(1) : 0;
                    rows.push({ label: c.label, grupo: d[c.sub] || d.label || d.key, total: d.total, pct });
                }
            }
            return rows;
        }

        const topGenero = topDeGrupo(dominancia.genero || [], 'genero');
        const topEdad = topDeGrupo(dominancia.edad || [], 'rango_edad');
        const topInstruccion = topDeGrupo(dominancia.instruccion || [], 'nivel_instruccion');
        const topOcupacion = topDeGrupo(dominancia.ocupacion || [], 'ocupacion');

        const coloresCandidato = {};
        const coloresPaleta = ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
        candidatos.forEach((c, i) => { coloresCandidato[c.candidato] = coloresPaleta[i % coloresPaleta.length]; });

        // Top candidato general
        const lider = candidatos[0];

        container.innerHTML = `
            <div style="background:#e0f2fe;border:1px solid #7dd3fc;border-radius:10px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-vote-yea" style="color:#0284c7;font-size:1.2rem;"></i>
                <span style="font-weight:700;color:#0369a1;font-size:0.95rem;">
                    Total de votos: ${totalVotos}
                </span>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
                <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">CANDIDATOS</div>
                    <div style="font-size:1.8rem;font-weight:800;color:#0f172a;">${candidatos.length}</div>
                    <div style="font-size:0.78rem;color:#64748b;">en competencia</div>
                </div>
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">LÍDER</div>
                    <div style="font-size:1.3rem;font-weight:800;color:#0f172a;line-height:1.3;">${lider.candidato}</div>
                    <div style="font-size:0.95rem;font-weight:700;color:#059669;">${lider.total} votos (${totalVotos > 0 ? ((lider.total / totalVotos) * 100).toFixed(1) : 0}%)</div>
                </div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:0.75rem;color:#64748b;font-weight:600;margin-bottom:6px;">DIGNIDADES</div>
                    <div style="font-size:1.8rem;font-weight:800;color:#0f172a;">${dignidadRes.length}</div>
                    <div style="font-size:0.78rem;color:#64748b;">con votos registrados</div>
                </div>
            </div>

            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:20px;">
                <h3 style="margin:0 0 14px 0;font-size:0.95rem;color:#0f172a;">
                    <i class="fas fa-ranking-star"></i> Resultados por candidato
                </h3>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${candidatos.map((c, i) => {
                        const pct = totalVotos > 0 ? ((c.total / totalVotos) * 100).toFixed(1) : 0;
                        const esLider = i === 0;
                        return `
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-weight:700;color:#64748b;min-width:24px;font-size:0.85rem;">${i + 1}.</span>
                                <span style="font-weight:600;color:#0f172a;min-width:150px;font-size:0.88rem;">${esLider ? '👑 ' : ''}${c.candidato}</span>
                                <div style="flex:1;background:#e2e8f0;border-radius:20px;height:10px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;border-radius:20px;background:${coloresCandidato[c.candidato]};transition:width 0.8s ease;"></div>
                                </div>
                                <span style="font-weight:700;color:#334155;min-width:70px;text-align:right;font-size:0.88rem;">${c.total} (${pct}%)</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div style="background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:20px;">
                <h3 style="margin:0 0 14px 0;font-size:0.95rem;color:#0f172a;">
                    <i class="fas fa-users-between-lines"></i> Dominancia demográfica
                </h3>
                <p style="font-size:0.8rem;color:#64748b;margin:0 0 14px 0;">¿Qué candidato lidera en cada segmento?</p>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;">
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                        <h4 style="margin:0 0 10px 0;font-size:0.83rem;color:#475569;"><i class="fas fa-venus-mars"></i> Por género</h4>
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            ${topGenero.map(g => {
                                const pctTotal = candidatos.find(c => c.candidato === g.candidato)?.total || 1;
                                const pctSeg = pctTotal > 0 ? ((g.total / pctTotal) * 100).toFixed(0) : 0;
                                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;">
                                    <span style="font-weight:600;font-size:0.82rem;color:#334155;">${g.genero}</span>
                                    <span style="display:flex;align-items:center;gap:4px;">
                                        <span style="font-size:0.82rem;color:#64748b;">${g.candidato}</span>
                                        <span style="font-weight:700;font-size:0.82rem;color:${coloresCandidato[g.candidato] || '#334155'};">${g.total}</span>
                                    </span>
                                </div>`;
                            }).join('') || '<span style="color:#94a3b8;font-size:0.8rem;">Sin datos</span>'}
                        </div>
                    </div>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                        <h4 style="margin:0 0 10px 0;font-size:0.83rem;color:#475569;"><i class="fas fa-calendar-alt"></i> Por edad</h4>
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            ${topEdad.map(e => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;">
                                    <span style="font-weight:600;font-size:0.82rem;color:#334155;">${e.rango_edad}</span>
                                    <span style="display:flex;align-items:center;gap:4px;">
                                        <span style="font-size:0.82rem;color:#64748b;">${e.candidato}</span>
                                        <span style="font-weight:700;font-size:0.82rem;color:${coloresCandidato[e.candidato] || '#334155'};">${e.total}</span>
                                    </span>
                                </div>
                            `).join('') || '<span style="color:#94a3b8;font-size:0.8rem;">Sin datos</span>'}
                        </div>
                    </div>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                        <h4 style="margin:0 0 10px 0;font-size:0.83rem;color:#475569;"><i class="fas fa-graduation-cap"></i> Por instrucción</h4>
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            ${topInstruccion.map(d => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;">
                                    <span style="font-weight:600;font-size:0.82rem;color:#334155;">${d.nivel_instruccion}</span>
                                    <span style="display:flex;align-items:center;gap:4px;">
                                        <span style="font-size:0.82rem;color:#64748b;">${d.candidato}</span>
                                        <span style="font-weight:700;font-size:0.82rem;color:${coloresCandidato[d.candidato] || '#334155'};">${d.total}</span>
                                    </span>
                                </div>
                            `).join('') || '<span style="color:#94a3b8;font-size:0.8rem;">Sin datos</span>'}
                        </div>
                    </div>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                        <h4 style="margin:0 0 10px 0;font-size:0.83rem;color:#475569;"><i class="fas fa-briefcase"></i> Por ocupación</h4>
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            ${topOcupacion.map(o => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;">
                                    <span style="font-weight:600;font-size:0.82rem;color:#334155;">${o.ocupacion}</span>
                                    <span style="display:flex;align-items:center;gap:4px;">
                                        <span style="font-size:0.82rem;color:#64748b;">${o.candidato}</span>
                                        <span style="font-weight:700;font-size:0.82rem;color:${coloresCandidato[o.candidato] || '#334155'};">${o.total}</span>
                                    </span>
                                </div>
                            `).join('') || '<span style="color:#94a3b8;font-size:0.8rem;">Sin datos</span>'}
                        </div>
                    </div>
                </div>
            </div>

            <h3 style="margin:0 0 14px 0;font-size:0.95rem;color:#0f172a;">
                <i class="fas fa-user-tie"></i> Perfil de votantes por candidato
            </h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
                ${candidatos.map(c => {
                    const perfil = perfiles[c.candidato] || { genero: [], edad: [], instruccion: [], ocupacion: [] };
                    const totalC = c.total;
                    const cols = [
                        { label: 'Género', data: perfil.genero, sub: 'genero' },
                        { label: 'Edad', data: perfil.edad, sub: 'rango_edad' },
                        { label: 'Instrucción', data: perfil.instruccion, sub: 'nivel_instruccion' },
                        { label: 'Ocupación', data: perfil.ocupacion, sub: 'ocupacion' }
                    ];
                    return `
                        <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                                <h4 style="margin:0;font-size:0.9rem;color:#0f172a;font-weight:700;">${c.candidato}</h4>
                                <span style="background:${coloresCandidato[c.candidato]};color:#fff;padding:2px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;">${totalC} votos</span>
                            </div>
                            ${cols.map(col => `
                                <div style="margin-bottom:10px;">
                                    <div style="font-size:0.72rem;font-weight:600;color:#64748b;margin-bottom:4px;">${col.label}</div>
                                    <div style="display:flex;flex-wrap:wrap;gap:4px;">
                                        ${(col.data || []).map(d => {
                                            const pct = totalC > 0 ? ((d.total / totalC) * 100).toFixed(0) : 0;
                                            return `<span style="background:#f1f5f9;padding:3px 8px;border-radius:6px;font-size:0.73rem;color:#334155;font-weight:600;">${d[col.sub]}: ${d.total} (${pct}%)</span>`;
                                        }).join('') || '<span style="color:#94a3b8;font-size:0.73rem;">Sin datos</span>'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (err) {
        console.error('Error cargando análisis resultados:', err);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Error al cargar análisis de resultados</div>';
    }
}

async function cargarFiltroAnalisisDignidad() {
    try {
        const res = await fetch(`${API_BASE_URL}/dignidades-estado`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.dignidades)) return;

        const items = data.dignidades
            .filter(d => d.habilitada && d.clave !== 'PREGUNTAS');

        const select = document.getElementById('filtroAnalisisDignidad');
        if (!select) return;

        const actual = select.value;
        select.innerHTML = items.map(d =>
            `<option value="${d.clave}">${formatearDignidad(d.clave)}</option>`
        ).join('');

        if (actual && items.some(d => d.clave === actual)) {
            select.value = actual;
        } else if (items.length > 0) {
            select.value = items[0].clave;
        }
    } catch (err) {
        console.warn('Error cargando filtro dignidad análisis:', err.message);
    }
}

async function cargarFiltroZonaAnalisisResultados() {
    const dignidad = document.getElementById('filtroAnalisisDignidad')?.value || 'todas';
    try {
        const params = new URLSearchParams({ dignidad });
        const res = await fetch(`${API_BASE_URL}/zonas-disponibles?${params}`, {
            headers: getApiHeaders()
        });
        const zonas = await res.json();
        const select = document.getElementById('filtroAnalisisZona');
        if (!select) return;
        const actual = select.value;
        select.innerHTML = '<option value="todas">Todas las Zonas</option>';
        if (Array.isArray(zonas)) {
            zonas.forEach(z => {
                const opt = document.createElement('option');
                opt.value = z.zona;
                opt.textContent = z.zona;
                select.appendChild(opt);
            });
        }
        if (actual) select.value = actual;
    } catch (err) {
        console.warn('Error cargando zonas:', err.message);
    }
}

// ============ UBICACIÓN ============

async function verificarVisibilidadMapa() {
    try {
        const res = await fetch(`${API_BASE_URL}/config-ubicacion`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        const permitido = data.success && !!data.permitir_ubicacion;
        const menuMapa = document.getElementById('menuMapa');
        const seccionMapa = document.getElementById('seccionMapa');
        if (menuMapa) menuMapa.style.display = permitido ? '' : 'none';
        if (seccionMapa) seccionMapa.style.display = permitido ? '' : 'none';
    } catch (err) {
        // Si falla, ocultamos por seguridad
        const menuMapa = document.getElementById('menuMapa');
        const seccionMapa = document.getElementById('seccionMapa');
        if (menuMapa) menuMapa.style.display = 'none';
        if (seccionMapa) seccionMapa.style.display = 'none';
    }
}

async function cargarEstadoUbicacion() {
    if (!esSuperadmin()) return;
    try {
        const res = await fetch(`${API_BASE_URL}/config-ubicacion`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) actualizarUIUbicacion(!!data.permitir_ubicacion);
    } catch (err) {
        const texto = document.getElementById('estadoUbicacionTexto');
        if (texto) texto.textContent = 'No se pudo cargar el estado.';
    }
}

function actualizarUIUbicacion(permitido) {
    const btn = document.getElementById('btnToggleUbicacion');
    const texto = document.getElementById('estadoUbicacionTexto');
    if (!btn || !texto) return;
    btn.dataset.permitido = permitido ? '1' : '0';
    if (permitido) {
        texto.textContent = 'La captura de ubicación está HABILITADA. Los encuestadores enviarán su ubicación al votar.';
        btn.className = 'btn-toggle-acceso desbloquear';
        btn.innerHTML = '<i class="fas fa-map-pin"></i> Deshabilitar ubicación';
    } else {
        texto.textContent = 'La captura de ubicación está DESHABILITADA. No se solicitará ubicación a los encuestadores.';
        btn.className = 'btn-toggle-acceso bloquear';
        btn.innerHTML = '<i class="fas fa-map-pin"></i> Habilitar ubicación';
    }
}

async function toggleUbicacion() {
    if (!esSuperadmin()) return;
    const btn = document.getElementById('btnToggleUbicacion');
    const permitido = btn?.dataset.permitido === '1';
    const nuevoEstado = !permitido;
    const msg = nuevoEstado
        ? '¿Habilitar captura de ubicación?\n\nLos encuestadores comenzarán a enviar su ubicación geográfica al registrar votos.'
        : '¿Deshabilitar captura de ubicación?\n\nNo se solicitará ubicación a los encuestadores.';
    if (!confirm(msg)) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...'; }
    try {
        const res = await fetch(`${API_BASE_URL}/config-ubicacion`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ permitir_ubicacion: nuevoEstado })
        });
        const data = await res.json();
        if (data.success) {
            actualizarUIUbicacion(!!data.permitir_ubicacion);
            alert('✅ ' + data.message);
        } else {
            alert('❌ ' + (data.message || 'Error'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ============ RESPUESTAS VISIBILIDAD ============

async function verificarVisibilidadRespuestas() {
    try {
        const res = await fetch(`${API_BASE_URL}/config-respuestas`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        const mostrar = data.success && !!data.mostrar_respuestas;
        const menuRespuestas = document.getElementById('menuRespuestas');
        const seccionRespuestas = document.getElementById('seccionRespuestas');
        const menuAnalisis = document.getElementById('menuAnalisisrespuestas');
        const seccionAnalisis = document.getElementById('seccionAnalisisrespuestas');
        const btnExcelPreguntas = document.getElementById('btnDescargarExcelPreguntas');
        if (menuRespuestas) menuRespuestas.style.display = mostrar ? '' : 'none';
        if (seccionRespuestas) seccionRespuestas.style.display = mostrar ? '' : 'none';
        if (menuAnalisis) menuAnalisis.style.display = mostrar ? '' : 'none';
        if (seccionAnalisis) seccionAnalisis.style.display = mostrar ? '' : 'none';
        if (btnExcelPreguntas) btnExcelPreguntas.style.display = mostrar ? '' : 'none';
    } catch (err) {
        const menuRespuestas = document.getElementById('menuRespuestas');
        const seccionRespuestas = document.getElementById('seccionRespuestas');
        const menuAnalisis = document.getElementById('menuAnalisisrespuestas');
        const seccionAnalisis = document.getElementById('seccionAnalisisrespuestas');
        const btnExcelPreguntas = document.getElementById('btnDescargarExcelPreguntas');
        if (menuRespuestas) menuRespuestas.style.display = 'none';
        if (seccionRespuestas) seccionRespuestas.style.display = 'none';
        if (menuAnalisis) menuAnalisis.style.display = 'none';
        if (seccionAnalisis) seccionAnalisis.style.display = 'none';
        if (btnExcelPreguntas) btnExcelPreguntas.style.display = 'none';
    }
}

async function cargarEstadoRespuestas() {
    if (!esSuperadmin()) return;
    try {
        const res = await fetch(`${API_BASE_URL}/config-respuestas`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) actualizarUIRespuestas(!!data.mostrar_respuestas);
    } catch (err) {
        const texto = document.getElementById('estadoRespuestasTexto');
        if (texto) texto.textContent = 'No se pudo cargar el estado.';
    }
}

function actualizarUIRespuestas(mostrar) {
    const btn = document.getElementById('btnToggleRespuestas');
    const texto = document.getElementById('estadoRespuestasTexto');
    if (!btn || !texto) return;
    btn.dataset.mostrar = mostrar ? '1' : '0';
    if (mostrar) {
        texto.textContent = 'La sección Respuestas está VISIBLE en el panel de administración.';
        btn.className = 'btn-toggle-acceso desbloquear';
        btn.innerHTML = '<i class="fas fa-poll"></i> Ocultar sección';
    } else {
        texto.textContent = 'La sección Respuestas está OCULTA en el panel de administración.';
        btn.className = 'btn-toggle-acceso bloquear';
        btn.innerHTML = '<i class="fas fa-poll"></i> Mostrar sección';
    }
}

async function toggleRespuestas() {
    if (!esSuperadmin()) return;
    const btn = document.getElementById('btnToggleRespuestas');
    const mostrar = btn?.dataset.mostrar === '1';
    const nuevoEstado = !mostrar;
    const msg = nuevoEstado
        ? '¿Mostrar sección Respuestas en el panel?'
        : '¿Ocultar sección Respuestas del panel?';
    if (!confirm(msg)) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...'; }
    try {
        const res = await fetch(`${API_BASE_URL}/config-respuestas`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ mostrar_respuestas: nuevoEstado })
        });
        const data = await res.json();
        if (data.success) {
            actualizarUIRespuestas(!!data.mostrar_respuestas);
            alert('✅ ' + data.message);
        } else {
            alert('❌ ' + (data.message || 'Error'));
        }
    } catch (err) {
        alert('⚠️ Error de conexión.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ============ MAPA DE VOTOS ============

const COLORES_CANDIDATOS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff',
    '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1',
    '#000075', '#a9a9a9', '#e6beff', '#ff4766'
];

let mapaVotosMarkers = [];
let mapaHeatLayer = null;
let mapaModo = 'puntos'; // 'puntos' | 'calor'

function alternarModoMapa() {
    mapaModo = mapaModo === 'puntos' ? 'calor' : 'puntos';
    document.getElementById('txtModoMapa').textContent = mapaModo === 'puntos' ? 'Calor' : 'Puntos';
    document.getElementById('btnModoMapa').style.background = mapaModo === 'puntos' ? '#fef3c7' : '#dbeafe';
    document.getElementById('btnModoMapa').style.color = mapaModo === 'puntos' ? '#b45309' : '#1d4ed8';
    document.getElementById('btnModoMapa').style.borderColor = mapaModo === 'puntos' ? '#fcd34d' : '#93c5fd';
    document.getElementById('btnModoMapa').innerHTML = mapaModo === 'puntos'
        ? '<i class="fas fa-fire"></i> <span id="txtModoMapa">Calor</span>'
        : '<i class="fas fa-map-marker-alt"></i> <span id="txtModoMapa">Puntos</span>';
    cargarMapaVotos();
}

function obtenerColorCandidato(candidato, index) {
    let hash = 0;
    for (let i = 0; i < candidato.length; i++) {
        hash = candidato.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLORES_CANDIDATOS[Math.abs(hash) % COLORES_CANDIDATOS.length];
}

async function cargarMapaVotos() {
    const container = document.getElementById('mapaVotos');
    if (!container) return;

    const dignidad = document.getElementById('filtroMapaDignidad')?.value || 'todas';

    // Inicializar mapa si no existe
    if (!window.mapaVotosInstance) {
        window.mapaVotosInstance = L.map('mapaVotos').setView([-2.456, -78.174], 14);
        L.tileLayer(`${API_BASE_URL}/tile/{z}/{x}/{y}`, {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(window.mapaVotosInstance);
        window.mapaMarkersGroup = L.featureGroup().addTo(window.mapaVotosInstance);
    } else {
        if (window.mapaMarkersGroup) window.mapaMarkersGroup.clearLayers();
        if (mapaHeatLayer) { window.mapaVotosInstance.removeLayer(mapaHeatLayer); mapaHeatLayer = null; }
    }

    try {
        const res = await fetch(`${API_BASE_URL}/ubicacion-votos?dignidad=${encodeURIComponent(dignidad)}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        const ubicaciones = data.ubicaciones || [];
        if (ubicaciones.length === 0) {
            document.getElementById('mapaLeyenda').innerHTML = '<span style="color:#94a3b8;">No hay ubicaciones registradas</span>';
            setTimeout(() => { if (window.mapaVotosInstance) window.mapaVotosInstance.invalidateSize(); }, 100);
            return;
        }

        if (mapaModo === 'calor') {
            // ——— MODO MAPA DE CALOR ———
            const puntos = [];
            ubicaciones.forEach(u => {
                const lat = parseFloat(u.latitud);
                const lng = parseFloat(u.longitud);
                if (isNaN(lat) || isNaN(lng)) return;
                puntos.push([lat, lng, 1]);
            });

            mapaHeatLayer = L.heatLayer(puntos, {
                radius: 30,
                blur: 20,
                maxZoom: 17,
                max: 1,
                gradient: {
                    0.2: '#313695',
                    0.4: '#4575b4',
                    0.6: '#74add1',
                    0.8: '#f46d43',
                    1.0: '#d73027'
                }
            }).addTo(window.mapaVotosInstance);

            if (puntos.length > 0 && window.mapaMarkersGroup) {
                try {
                    window.mapaVotosInstance.fitBounds(window.mapaMarkersGroup.getBounds().pad(0.2), { padding: [40, 40] });
                } catch (e) { /* ignore */ }
            }

            document.getElementById('mapaLeyenda').innerHTML = `
                <span style="font-size:0.83rem;color:#64748b;margin-right:8px;">
                    <i class="fas fa-info-circle"></i> Mapa de calor por densidad de votos
                </span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;">
                    <span style="width:12px;height:12px;border-radius:2px;background:#313695;"></span> Baja
                </span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;">
                    <span style="width:12px;height:12px;border-radius:2px;background:#74add1;"></span> Media
                </span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;">
                    <span style="width:12px;height:12px;border-radius:2px;background:#f46d43;"></span> Alta
                </span>
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;">
                    <span style="width:12px;height:12px;border-radius:2px;background:#d73027;"></span> Muy alta
                </span>
            `;
        } else {
            // ——— MODO PUNTOS POR CANDIDATO ———
            const candidatoColores = {};
            ubicaciones.forEach((u, i) => {
                if (!candidatoColores[u.candidato]) {
                    candidatoColores[u.candidato] = obtenerColorCandidato(u.candidato, i);
                }
            });

            let gpsCount = 0;
            ubicaciones.forEach(u => {
                const lat = parseFloat(u.latitud);
                const lng = parseFloat(u.longitud);
                if (isNaN(lat) || isNaN(lng)) return;
                const color = candidatoColores[u.candidato] || '#333';
                const marker = L.circleMarker([lat, lng], {
                    radius: 8, fillColor: color, color: '#ffffff',
                    weight: 2, opacity: 1, fillOpacity: 0.9
                });
                marker.bindPopup(`
                    <b>${u.candidato}</b><br>
                    Dignidad: ${u.dignidad}<br>
                    Zona: ${u.zona}<br>
                    Encuestador: ${u.encuestador || '—'}<br>
                    ${u.fecha_voto ? new Date(u.fecha_voto).toLocaleString() : ''}
                `);
                if (window.mapaMarkersGroup) marker.addTo(window.mapaMarkersGroup);
                mapaVotosMarkers.push(marker);
                gpsCount++;
            });

            if (gpsCount > 0 && window.mapaVotosInstance && window.mapaMarkersGroup) {
                try {
                    window.mapaVotosInstance.fitBounds(window.mapaMarkersGroup.getBounds(), { padding: [40, 40] });
                } catch (e) { /* ignore */ }
            }

            const leyenda = document.getElementById('mapaLeyenda');
            leyenda.innerHTML = Object.entries(candidatoColores)
                .map(([candidato, color]) =>
                    `<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.83rem;">
                        <span style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
                        ${candidato}
                    </span>`
                ).join('');
        }

        setTimeout(() => { if (window.mapaVotosInstance) window.mapaVotosInstance.invalidateSize(); }, 100);

    } catch (err) {
        console.warn('⚠️ Error cargando mapa:', err.message);
        const leyenda = document.getElementById('mapaLeyenda');
        if (leyenda) leyenda.innerHTML = '<span style="color:#ef4444;">Error al cargar ubicaciones</span>';
    }
}

// ============ CERRAR SESIÓN ============
function cerrarSesion() {
    if (confirm("¿Desea cerrar la sesión?")) {
        localStorage.removeItem("idUsuario");
        localStorage.removeItem("nombreUsuarioActivo");
        localStorage.removeItem("rolUsuario");
        localStorage.removeItem("adminDignidad");
        localStorage.removeItem("zonaSeleccionada");
        localStorage.removeItem("sesionActiva");
        localStorage.removeItem("authToken");
        window.location.href = "../acceso/acceso.html";
    }
}
