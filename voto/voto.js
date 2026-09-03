/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * Script: voto.js - Registro de Votos con Soporte Offline
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

const NGROK_HEADERS = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
};

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

let candidatosCache = null;

async function cargarCandidatosDesdeAPI(dignidad, zonaSeleccionada) {
    const cacheKey = `candidatos_${dignidad}_${zonaSeleccionada}`;
    try {
        const params = new URLSearchParams({ dignidad });
        if (zonaSeleccionada) params.set('zona', zonaSeleccionada);
        const res = await fetch(`${API_BASE_URL}/candidatos?${params}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) {
            candidatosCache = data.candidatos;
            localStorage.setItem(cacheKey, JSON.stringify(data.candidatos));
            return data.candidatos;
        }
    } catch (err) {
        console.warn('⚠️ Error cargando candidatos, usando caché:', err.message);
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            candidatosCache = JSON.parse(cached);
            return candidatosCache;
        }
    }
    return [];
}

function renderizarCandidatosPorDignidad(dignidad, zonaSeleccionada) {
    const grid = document.getElementById('candidatosGrid');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-circle-notch fa-spin"></i> Cargando candidatos...</div>';

    cargarCandidatosDesdeAPI(dignidad, zonaSeleccionada).then(lista => {
        grid.innerHTML = '';

        if (!lista || lista.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8;">No hay candidatos registrados para esta dignidad</div>';
            return;
        }

        let hayNoDecido = lista.some(c => c.nombre === 'NO DECIDO');

        for (const c of lista) {
            const card = document.createElement('div');
            card.className = 'card-candidato';

            const imgWrap = document.createElement('div');
            imgWrap.className = 'img-wrapper';

            const img = document.createElement('img');
            const fotoUrl = c.foto ? `${API_BASE_URL}/encuesta/assets/candidatos/${encodeURIComponent(c.foto)}` : `${API_BASE_URL}/encuesta/assets/candidatos/placeholder-candidato.svg`;
            img.src = fotoUrl;
            img.alt = c.nombre;
            img.onerror = function() { this.src = `${API_BASE_URL}/encuesta/assets/candidatos/placeholder-candidato.svg`; };

            const h4 = document.createElement('h4');
            h4.innerText = c.nombre;

            imgWrap.appendChild(img);
            card.appendChild(imgWrap);
            card.appendChild(h4);

            card.addEventListener('click', () => enviarVoto(c.nombre));

            grid.appendChild(card);
        }

        if (!hayNoDecido) {
            const card = document.createElement('div');
            card.className = 'card-candidato';
            const imgWrap = document.createElement('div');
            imgWrap.className = 'img-wrapper';
            const img = document.createElement('img');
            img.src = `${API_BASE_URL}/encuesta/assets/candidatos/placeholder-candidato.svg`;
            img.alt = 'NO DECIDO';
            const h4 = document.createElement('h4');
            h4.innerText = 'NO DECIDO';
            imgWrap.appendChild(img);
            card.appendChild(imgWrap);
            card.appendChild(h4);
            card.addEventListener('click', () => enviarVoto('NO DECIDO'));
            grid.appendChild(card);
        }
    });
}

/**
 * INICIALIZACIÓN
 */
document.addEventListener('DOMContentLoaded', () => {
    const zona = localStorage.getItem("zonaSeleccionada");
    const idEncuestador = localStorage.getItem("idUsuario");
    const dignidad = localStorage.getItem("dignidadSeleccionada");
    const display = document.getElementById('displayZona');

    if (!idEncuestador) {
        window.location.href = "../acceso/acceso.html";
        return;
    }

    if (!dignidad) {
        window.location.href = "../dignidad/dignidad.html";
        return;
    }

    if (!zona) {
        window.location.href = "../zona/zona.html";
        return;
    }

    if (display) {
        display.innerText = zona;
    }

    const h2 = document.querySelector('.header-encuesta h2');
    if (h2) h2.innerText = `Registro de Intención de Voto — ${formatearDignidad(dignidad)}`;

    if (dignidad === 'PREGUNTAS') {
        renderizarPreguntas(zona);
    } else {
        renderizarCandidatosPorDignidad(dignidad, zona);
    }

    if (navigator.onLine) {
        sincronizarVotosPendientes();
    }
});

function regresarAZona() {
    window.location.href = "../zona/zona.html";
}

/**
 * PROCESA EL VOTO
 */
async function enviarVoto(nombreCandidato) {
    const zona = localStorage.getItem("zonaSeleccionada");
    const idEncuestador = localStorage.getItem("idUsuario");
    const dignidad = localStorage.getItem("dignidadSeleccionada") || 'ALCALDE';

    if (!idEncuestador) {
        alert("⚠️ Sesión expirada. Inicie sesión de nuevo.");
        window.location.href = "../acceso/acceso.html";
        return;
    }

    // Validar edad
    const edadCheck = document.querySelector('input[name="edad"]:checked');
    if (!edadCheck) {
        alert("⚠️ Por favor, seleccione el rango de edad primero.");
        return;
    }

    // Validar género — usa name="genero" igual que el HTML
    const generoCheck = document.querySelector('input[name="genero"]:checked');
    if (!generoCheck) {
        alert("⚠️ Por favor, seleccione el género primero.");
        return;
    }

    // Validar nivel de instrucción
    const instruccionCheck = document.querySelector('input[name="instruccion"]:checked');
    if (!instruccionCheck) {
        alert("⚠️ Por favor, seleccione el nivel de instrucción primero.");
        return;
    }

    // Validar ocupación
    const ocupacionCheck = document.querySelector('input[name="ocupacion"]:checked');
    if (!ocupacionCheck) {
        alert("⚠️ Por favor, seleccione la ocupación primero.");
        return;
    }

    // Bloquear UI inmediatamente para evitar doble clic durante async
    bloquearUI();

    let latitud = null, longitud = null;
    try {
        const configRes = await fetch(`${API_BASE_URL}/config-ubicacion`, {
            headers: getApiHeaders()
        });
        const configData = await configRes.json();
        if (configData.success && configData.permitir_ubicacion && navigator.geolocation) {
            const pos = await new Promise((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true, timeout: 8000, maximumAge: 60000
                })
            );
            latitud = pos.coords.latitude;
            longitud = pos.coords.longitude;
        }
    } catch (err) {
        // Ubicación no disponible o denegada — continuar sin ella
    }

    const datosVoto = {
        dignidad: dignidad,
        zona: zona,
        rango_edad: edadCheck.value,
        genero: generoCheck.value,
        nivel_instruccion: instruccionCheck.value,
        ocupacion: ocupacionCheck.value,
        candidato: nombreCandidato,
        id_encuestador: parseInt(idEncuestador),
        latitud,
        longitud
    };

    if (navigator.onLine) {
        try {
            const respuesta = await fetch(`${API_BASE_URL}/votar`, {
                method: 'POST',
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(datosVoto)
            });

            const resultado = await respuesta.json();

            if (resultado.codigo === 'ACCESO_BLOQUEADO') {
                localStorage.setItem('sistemaAccesoBloqueado', '1');
                activarUI();
                alert('🔒 ' + (resultado.message || 'El sistema está bloqueado.'));
                return;
            }

            if (resultado.success) {
                mostrarExito();
            } else {
                activarUI();
                alert("❌ Error del servidor: " + resultado.message);
            }
        } catch (error) {
            console.warn("⚠️ Fallo online, guardando offline:", error.message);
            manejarVotoOffline(datosVoto);
        }
    } else {
        manejarVotoOffline(datosVoto);
    }
}

/**
 * GUARDA EL VOTO LOCALMENTE (OFFLINE)
 */
function manejarVotoOffline(voto) {
    let pendientes = JSON.parse(localStorage.getItem("votosOffline")) || [];
    pendientes.push({ ...voto, guardadoEn: new Date().toISOString() });
    localStorage.setItem("votosOffline", JSON.stringify(pendientes));
    mostrarExito();
}

/**
 * PANTALLA DE ÉXITO Y RESET
 */
function mostrarExito() {
    const fb = document.getElementById('feedback');
    if (fb) fb.style.display = 'flex';

    setTimeout(() => {
        activarUI();

        // ✅ Limpiar selecciones correctamente
        document.querySelectorAll('input[name="edad"]').forEach(e => e.checked = false);
        document.querySelectorAll('input[name="genero"]').forEach(g => g.checked = false);
        document.querySelectorAll('input[name="instruccion"]').forEach(i => i.checked = false);
        document.querySelectorAll('input[name="ocupacion"]').forEach(o => o.checked = false);

        window.location.href = "../zona/zona.html";
    }, 1200);
}

function bloquearUI() {
    document.body.style.pointerEvents = "none";
    document.body.style.opacity = "0.7";
}

function activarUI() {
    document.body.style.pointerEvents = "auto";
    document.body.style.opacity = "1";
}

/**
 * SINCRONIZACIÓN AUTOMÁTICA DE VOTOS PENDIENTES
 */
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
}

window.addEventListener('online', () => {
    sincronizarVotosPendientes();
});

function renderizarPreguntasHTML(preguntas) {
    return `
        <div style="grid-column:1/-1;">
            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;">
                <p style="font-weight:600;color:#0f172a;margin:0 0 12px 0;font-size:0.95rem;">
                    <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> ¿Cuál es el principal problema de su barrio / parroquia?
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${['Seguridad','Agua potable','Alcantarillado','Calles','Alumbrado','Empleo','Salud','Educación'].map(p => `
                        <label style="display:inline-flex;align-items:center;cursor:pointer;padding:8px 16px;border-radius:8px;border:1.5px solid #fde68a;background:#fffbeb;transition:all 0.2s;">
                            <input type="radio" name="problema_principal" value="${p}" style="accent-color:#f59e0b;">
                            <span style="font-weight:600;color:#92400e;font-size:0.85rem;margin-left:4px;">${p}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;">
                <p style="font-weight:600;color:#0f172a;margin:0 0 12px 0;font-size:0.95rem;">
                    <i class="fas fa-broadcast-tower" style="color:#38bdf8;"></i> ¿Dónde se informa principalmente?
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${['Radio','Facebook / WhatsApp','TV','Perifoneo','Volantes','Periódico'].map(m => `
                        <label style="display:inline-flex;align-items:center;cursor:pointer;padding:8px 16px;border-radius:8px;border:1.5px solid #bfdbfe;background:#eff6ff;transition:all 0.2s;">
                            <input type="radio" name="medio_informacion" value="${m}" style="accent-color:#3b82f6;">
                            <span style="font-weight:600;color:#1e40af;font-size:0.85rem;margin-left:4px;">${m}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            ${preguntas.map((p, i) => `
                <div class="pregunta-card" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;">
                    <p style="font-weight:600;color:#0f172a;margin:0 0 10px 0;font-size:0.95rem;">
                        ${i + 1}. ${p.pregunta}
                    </p>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1.5px solid #22c55e;background:#f0fdf4;transition:all 0.2s;">
                            <input type="radio" name="preg_${p.id}" value="muy_de_acuerdo" required style="accent-color:#22c55e;">
                            <span style="font-weight:600;color:#166534;font-size:0.85rem;">Muy de acuerdo</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1.5px solid #86efac;background:#f0fdf4;transition:all 0.2s;">
                            <input type="radio" name="preg_${p.id}" value="de_acuerdo" required style="accent-color:#22c55e;">
                            <span style="font-weight:600;color:#166534;font-size:0.85rem;">De acuerdo</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1.5px solid #94a3b8;background:#f8fafc;transition:all 0.2s;">
                            <input type="radio" name="preg_${p.id}" value="indiferente" required style="accent-color:#64748b;">
                            <span style="font-weight:600;color:#475569;font-size:0.85rem;">Indiferente</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1.5px solid #fca5a5;background:#fef2f2;transition:all 0.2s;">
                            <input type="radio" name="preg_${p.id}" value="en_desacuerdo" required style="accent-color:#ef4444;">
                            <span style="font-weight:600;color:#991b1b;font-size:0.85rem;">En desacuerdo</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:8px 14px;border-radius:8px;border:1.5px solid #ef4444;background:#fef2f2;transition:all 0.2s;">
                            <input type="radio" name="preg_${p.id}" value="totalmente_en_desacuerdo" required style="accent-color:#dc2626;">
                            <span style="font-weight:600;color:#7f1d1d;font-size:0.85rem;">Totalmente en desacuerdo</span>
                        </label>
                    </div>
                </div>
            `).join('')}
            <div style="text-align:center;margin-top:20px;">
                <button id="btnEnviarPreguntas" onclick="enviarRespuestas()" class="btn-submit-preguntas" style="
                    background:#059669;color:white;border:none;padding:14px 40px;border-radius:12px;
                    font-size:1.05rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;
                    transition:background 0.2s;box-shadow:0 4px 12px rgba(5,150,105,0.3);"
                    onmouseover="this.style.background='#047857'" onmouseout="this.style.background='#059669'">
                    <i class="fas fa-paper-plane"></i> Enviar respuestas
                </button>
            </div>
        </div>
    `;
}

// ============ PREGUNTAS ============

async function renderizarPreguntas(zona) {
    const grid = document.getElementById('candidatosGrid');
    if (!grid) return;

    try {
        const res = await fetch(`${API_BASE_URL}/preguntas?activas=1`, {
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error('Error');

        const preguntas = data.preguntas || [];
        localStorage.setItem('preguntas_cache', JSON.stringify(preguntas));
        if (preguntas.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8;">No hay preguntas activas</div>';
            return;
        }

        grid.innerHTML = renderizarPreguntasHTML(preguntas);
    } catch (err) {
        console.warn('⚠️ Error cargando preguntas, usando caché:', err.message);
        const cached = localStorage.getItem('preguntas_cache');
        if (cached) {
            const preguntas = JSON.parse(cached);
            if (preguntas.length === 0) {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8;">No hay preguntas activas</div>';
                return;
            }
            grid.innerHTML = renderizarPreguntasHTML(preguntas);
            return;
        }
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">Error al cargar preguntas. Conéctese a internet para obtenerlas.</div>';
    }
}

async function enviarRespuestas() {
    const zona = localStorage.getItem("zonaSeleccionada");
    const idEncuestador = localStorage.getItem("idUsuario");

    if (!idEncuestador) {
        alert("⚠️ Sesión expirada. Inicie sesión de nuevo.");
        window.location.href = "../acceso/acceso.html";
        return;
    }

    const edadCheck = document.querySelector('input[name="edad"]:checked');
    if (!edadCheck) {
        alert("⚠️ Por favor, seleccione el rango de edad primero.");
        return;
    }

    const generoCheck = document.querySelector('input[name="genero"]:checked');
    if (!generoCheck) {
        alert("⚠️ Por favor, seleccione el género primero.");
        return;
    }

    const instruccionCheck = document.querySelector('input[name="instruccion"]:checked');
    if (!instruccionCheck) {
        alert("⚠️ Por favor, seleccione el nivel de instrucción primero.");
        return;
    }

    const ocupacionCheck = document.querySelector('input[name="ocupacion"]:checked');
    if (!ocupacionCheck) {
        alert("⚠️ Por favor, seleccione la ocupación primero.");
        return;
    }

    const problemaCheck = document.querySelector('input[name="problema_principal"]:checked');
    if (!problemaCheck) {
        alert("⚠️ Por favor, seleccione el principal problema de su barrio/parroquia.");
        return;
    }

    const medioCheck = document.querySelector('input[name="medio_informacion"]:checked');
    if (!medioCheck) {
        alert("⚠️ Por favor, seleccione su medio de información principal.");
        return;
    }

    // Recolectar respuestas
    const preguntas = document.querySelectorAll('[id^="preg_"],[name^="preg_"]');
    const respuestas = [];
    document.querySelectorAll('input[type="radio"][name^="preg_"]:checked').forEach(input => {
        const id_pregunta = parseInt(input.name.replace('preg_', ''));
        respuestas.push({ id_pregunta, respuesta: input.value });
    });

    if (respuestas.length === 0) {
        alert("⚠️ Por favor, responda al menos una pregunta.");
        return;
    }

    bloquearUI();

    let latitud = null, longitud = null;
    try {
        const configRes = await fetch(`${API_BASE_URL}/config-ubicacion`, {
            headers: getApiHeaders()
        });
        const configData = await configRes.json();
        if (configData.success && configData.permitir_ubicacion && navigator.geolocation) {
            const pos = await new Promise((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true, timeout: 8000, maximumAge: 60000
                })
            );
            latitud = pos.coords.latitude;
            longitud = pos.coords.longitude;
        }
    } catch (err) {}

    const datos = {
        zona,
        rango_edad: edadCheck.value,
        genero: generoCheck.value,
        nivel_instruccion: instruccionCheck.value,
        ocupacion: ocupacionCheck.value,
        problema_principal: problemaCheck.value,
        medio_informacion: medioCheck.value,
        respuestas,
        latitud,
        longitud
    };

    if (navigator.onLine) {
        try {
            const respuesta = await fetch(`${API_BASE_URL}/votar-preguntas`, {
                method: 'POST',
                headers: getApiHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(datos)
            });
            const resultado = await respuesta.json();
            if (resultado.codigo === 'ACCESO_BLOQUEADO') {
                localStorage.setItem('sistemaAccesoBloqueado', '1');
                activarUI();
                alert('🔒 ' + (resultado.message || 'El sistema está bloqueado.'));
                return;
            }
            if (resultado.success) {
                mostrarExito();
            } else {
                activarUI();
                alert("❌ Error del servidor: " + resultado.message);
            }
        } catch (error) {
            console.warn("⚠️ Fallo online, guardando offline:", error.message);
            manejarVotoOffline(datos);
        }
    } else {
        manejarVotoOffline(datos);
    }
}
