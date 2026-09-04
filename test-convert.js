function pgConvert(sql, params = []) {
    let idx = 1;
    let s = sql.replace(/\?/g, () => `$${idx++}`);
    const pkMap = { sistema_config: 'clave', dignidad_config: 'clave', usuarios: 'usuario', fotos_actas: 'junta_id', resultados: 'junta_id, dignidad, candidato' };
    const tableMatch = s.match(/INSERT\s+INTO\s+(\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : '';
    const pk = pkMap[tableName] || 'id';
    s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([^\n]*?)(?=\s*RETURNING|\s*;|\s*$)/gi, (match, clause) => {
        const converted = clause.replace(/(\w+)\s*=\s*VALUES\(\w+\)/gi, '$1 = EXCLUDED.$1');
        return `ON CONFLICT (${pk}) DO UPDATE SET ${converted}`;
    });
    return s;
}

// Test 1: multi-column ON DUPLICATE KEY
const sql1 = `INSERT INTO resultados (junta_id, dignidad, candidato, votos, id_veedor)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE votos=VALUES(votos), id_veedor=VALUES(id_veedor)`;
console.log('=== Test 1: resultados multi-column ===');
console.log(pgConvert(sql1));

// Test 2: single column ON DUPLICATE KEY
const sql2 = `INSERT INTO sistema_config (clave, valor) VALUES ('permitir_ubicacion', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`;
console.log('\n=== Test 2: sistema_config single ===');
console.log(pgConvert(sql2));

// Test 3: fotos_actas multi-column
const sql3 = `INSERT INTO fotos_actas (junta_id, foto, id_veedor)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE foto=VALUES(foto), id_veedor=VALUES(id_veedor), fecha_subida=NOW()`;
console.log('\n=== Test 3: fotos_actas multi ===');
console.log(pgConvert(sql3));

// Test 4: dignidad_config
const sql4 = `INSERT INTO dignidad_config (clave, habilitada) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada)`;
console.log('\n=== Test 4: dignidad_config ===');
console.log(pgConvert(sql4));
