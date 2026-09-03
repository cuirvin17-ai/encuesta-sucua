/**
 * SISTEMA DE ENCUESTAS SUCÚA 2026
 * Script: registro.js
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

// ✅ CORREGIDO: verificación de seguridad eliminada aquí
// (ya la hace registro.html en el <head> con IIFE — no duplicar)

document.getElementById('formRegistro').addEventListener('submit', async function(e) {
    e.preventDefault();

    const cedula  = document.getElementById('reg-cedula').value.trim();
    const usuario = document.getElementById('reg-user').value.trim();
    const pass    = document.getElementById('reg-pass').value.trim();
    const rol     = document.getElementById('reg-rol').value;

    if (cedula.length < 3) {
        alert("⚠️ Ingresa un número de cédula válido.");
        return;
    }

    if (usuario.length < 3) {
        alert("⚠️ El nombre de usuario debe tener al menos 3 caracteres.");
        return;
    }

    if (pass.length < 4) {
        alert("⚠️ La contraseña debe tener al menos 4 caracteres.");
        return;
    }

    const btn = document.getElementById('btnCrear');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
    btn.disabled = true;

    try {
        const respuesta = await fetch(`${API_BASE_URL}/registrar`, {
            method: 'POST',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ cedula, usuario, password: pass, rol })
        });

        const data = await respuesta.json();

        if (data.success) {
            mostrarFeedbackExito();
            document.getElementById('formRegistro').reset();
            if (document.activeElement) document.activeElement.blur();
        } else {
            alert("❌ Error: " + (data.message || "No se pudo registrar el usuario."));
        }

    } catch (error) {
        console.error("Error de conexión:", error);
        alert("⚠️ Error de red. Verifica que ngrok y el servidor estén encendidos.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

function mostrarFeedbackExito() {
    const alerta = document.getElementById('msgFeedback');
    if (!alerta) { alert("✅ Usuario registrado correctamente"); return; }

    alerta.style.display = 'flex';
    alerta.style.opacity = '1';

    setTimeout(() => {
        alerta.style.transition = 'opacity 0.6s ease';
        alerta.style.opacity = '0';
        setTimeout(() => {
            alerta.style.display = 'none';
            alerta.style.transition = '';
        }, 600);
    }, 3500);
}
