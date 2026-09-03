/**
 * diagnóstico.js - Verificar PWA en el celular
 */

console.clear();
console.log('🔍 === DIAGNÓSTICO PWA ===\n');

// 1. Verificar Service Worker
if ('serviceWorker' in navigator) {
    console.log('✅ Service Worker soportado');
    
    navigator.serviceWorker.getRegistrations().then(registrations => {
        console.log(`📊 Service Workers registrados: ${registrations.length}`);
        
        registrations.forEach((reg, i) => {
            console.log(`  [${i}] Scope: ${reg.scope}`);
            console.log(`      Active: ${reg.active ? '✅ Sí' : '❌ No'}`);
            console.log(`      Waiting: ${reg.waiting ? '⏳ Sí' : '❌ No'}`);
            console.log(`      Installing: ${reg.installing ? '⚙️ Sí' : '❌ No'}`);
        });
    });
} else {
    console.error('❌ Service Worker NO soportado');
}

// 2. Verificar Manifest
fetch('./manifest.json')
    .then(r => r.json())
    .then(manifest => {
        console.log('\n✅ Manifest.json cargado:');
        console.log('   name:', manifest.name);
        console.log('   start_url:', manifest.start_url);
        console.log('   display:', manifest.display);
    })
    .catch(err => console.error('❌ Error manifest:', err.message));

// 3. Verificar LocalStorage
console.log('\n📦 LocalStorage:');
const keys = Object.keys(localStorage);
if (keys.length === 0) {
    console.log('   (vacío - sin datos guardados)');
} else {
    keys.forEach(key => {
        const value = localStorage.getItem(key);
        console.log(`   ${key}:`, value.substring(0, 50) + '...');
    });
}

// 4. Verificar conexión
console.log('\n🌐 Conexión:');
console.log('   Online:', navigator.onLine ? '✅ Sí' : '❌ No');

// 5. Verificar Cache API
caches.keys().then(names => {
    console.log('\n💾 Cachés disponibles:');
    if (names.length === 0) {
        console.log('   (ninguno)');
    } else {
        names.forEach(name => {
            caches.open(name).then(cache => {
                cache.keys().then(requests => {
                    console.log(`   ${name}: ${requests.length} items`);
                });
            });
        });
    }
});

// 6. Info de dispositivo
console.log('\n📱 Dispositivo:');
console.log('   User Agent:', navigator.userAgent.substring(0, 60) + '...');
console.log('   Plataforma:', navigator.platform);
console.log('   Lenguaje:', navigator.language);

// 7. Espacio de almacenamiento
if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(estimate => {
        const percent = Math.round((estimate.usage / estimate.quota) * 100);
        console.log('\n💿 Almacenamiento:');
        console.log(`   Usado: ${(estimate.usage / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Total: ${(estimate.quota / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Uso: ${percent}%`);
    });
}

console.log('\n✅ === FIN DIAGNÓSTICO ===\n');

// Exportar función para ejecutar desde consola
window.diagnosticoPWA = {
    clearCache: async () => {
        const names = await caches.keys();
        const results = await Promise.all(names.map(n => caches.delete(n)));
        console.log(`✅ ${results.length} cachés limpiados`);
    },
    clearStorage: () => {
        localStorage.clear();
        console.log('✅ LocalStorage limpiado');
    },
    reloadSW: async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => r.unregister());
        console.log('✅ Service Workers desinstalados. Recarga la página.');
    },
    getStatus: () => {
        return {
            online: navigator.onLine,
            swSupported: 'serviceWorker' in navigator,
            swActive: navigator.serviceWorker?.controller ? true : false,
            storageUsed: Object.keys(localStorage).length
        };
    }
};

console.log('💡 Disponibles: diagnosticoPWA.clearCache(), diagnosticoPWA.clearStorage(), diagnosticoPWA.reloadSW()');