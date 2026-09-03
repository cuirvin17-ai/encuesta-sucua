/**
 * install-pwa.js - Gestiona la instalación de la PWA
 * Sistema de Encuestas Sucúa 2026
 * NOTA: El Service Worker ya es registrado por acceso.js
 *       Este archivo solo maneja la lógica del botón instalar
 */

let deferredPrompt = null;

// ========== 1. CAPTURAR EVENTO DE INSTALACIÓN ==========
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('✅ PWA instalable detectada');
    e.preventDefault();
    deferredPrompt = e;

    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.style.display = 'block';
    }
});

// ========== 2. BOTÓN INSTALAR ==========
document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('installBtn');
    if (!installBtn) return;

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
                alert('✅ ¡Aplicación instalada! Ya puedes usarla sin conexión.');
            } else {
                console.log('❌ Usuario rechazó instalación');
            }

            deferredPrompt = null;
            installBtn.style.display = 'none';
        } catch (err) {
            console.error('Error instalando:', err);
        }
    });
});

// ========== 3. DETECTAR APP YA INSTALADA ==========
window.addEventListener('appinstalled', () => {
    console.log('✅ PWA instalada exitosamente');
    localStorage.setItem('pwaInstalada', 'true');

    const installBtn = document.getElementById('installBtn');
    if (installBtn) installBtn.style.display = 'none';
});

// ========== 4. INSTRUCCIONES PARA iOS ==========
function esIOS() {
    const ua = navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/chrome/.test(ua);
}

if (esIOS()) {
    document.addEventListener('DOMContentLoaded', () => {
        const loginCard = document.querySelector('.login-card');
        if (!loginCard) return;

        const div = document.createElement('div');
        div.style.cssText = `
            background: #e8f4f8;
            border: 1px solid #00a884;
            border-radius: 8px;
            padding: 12px;
            margin-top: 16px;
            font-size: 0.85em;
            color: #333;
        `;
        div.innerHTML = `
            <strong>📱 Para instalar en iPhone/iPad:</strong><br>
            1. Toca el botón compartir (↑)<br>
            2. Selecciona "Agregar a pantalla de inicio"<br>
            3. ¡Listo! Funciona sin conexión
        `;
        loginCard.appendChild(div);
    });
}

// ========== 5. INFO DE ESTADO PWA ==========
window.PWAInfo = {
    isInstalled: () => window.matchMedia('(display-mode: standalone)').matches,
    isInstalable: () => deferredPrompt !== null,
    getStatus: () => ({
        installed:  window.matchMedia('(display-mode: standalone)').matches,
        instalable: deferredPrompt !== null,
        online:     navigator.onLine,
        swActive:   'serviceWorker' in navigator
    })
};

console.log('📱 PWA Status:', window.PWAInfo.getStatus());
