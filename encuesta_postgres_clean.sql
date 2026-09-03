-- PostgreSQL script para encuesta_sucua_bd
-- Generado desde MySQL dump

-- Eliminar tablas si existen
DROP TABLE IF EXISTS votos CASCADE;
DROP TABLE IF EXISTS respuestas CASCADE;
DROP TABLE IF EXISTS preguntas CASCADE;
DROP TABLE IF EXISTS candidatos CASCADE;
DROP TABLE IF EXISTS dignidad_config CASCADE;
DROP TABLE IF EXISTS sistema_config CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- Tabla usuarios
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    usuario VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(50) DEFAULT 'admin'
);

-- Tabla sistema_config
CREATE TABLE sistema_config (
    clave VARCHAR(64) PRIMARY KEY,
    valor VARCHAR(255) NOT NULL DEFAULT '0'
);

-- Tabla dignidad_config
CREATE TABLE dignidad_config (
    clave VARCHAR(64) PRIMARY KEY,
    habilitada BOOLEAN NOT NULL DEFAULT TRUE
);

-- Tabla candidatos
CREATE TABLE candidatos (
    id SERIAL PRIMARY KEY,
    dignidad VARCHAR(40) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    foto VARCHAR(255) NOT NULL DEFAULT 'placeholder-candidato.svg',
    zona VARCHAR(100) DEFAULT NULL,
    orden INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dignidad ON candidatos(dignidad);
CREATE INDEX idx_dignidad_zona ON candidatos(dignidad, zona);

-- Tabla preguntas
CREATE TABLE preguntas (
    id SERIAL PRIMARY KEY,
    pregunta TEXT NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    orden INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla respuestas
CREATE TABLE respuestas (
    id SERIAL PRIMARY KEY,
    votante_id VARCHAR(100),
    pregunta_id INT REFERENCES preguntas(id),
    respuesta VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla votos
CREATE TABLE votos (
    id_voto SERIAL PRIMARY KEY,
    dignidad VARCHAR(40) NOT NULL DEFAULT 'ALCALDE',
    candidato_id INT REFERENCES candidatos(id),
    votante_id VARCHAR(100),
    zona VARCHAR(100),
    parroquia VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Datos iniciales
INSERT INTO usuarios (usuario, password, rol) VALUES ('admin', 'admin123', 'superadmin');

INSERT INTO sistema_config (clave, valor) VALUES ('acceso_bloqueado', '0');

INSERT INTO dignidad_config (clave, habilitada) VALUES 
    ('ALCALDE', TRUE),
    ('CONCEJALES_URBANOS', TRUE),
    ('CONCEJALES_RURALES', TRUE),
    ('JUNTAS_PARROQUIALES', TRUE),
    ('PREGUNTAS', TRUE);

-- Datos de candidatos
INSERT INTO candidatos (id, dignidad, nombre, foto, zona, orden, created_at) VALUES
    (2, 'ALCALDE', 'Chistian Perez', '1780695378407-o7de2g.jpg', NULL, 1, '2026-06-05 21:36:18'),
    (3, 'ALCALDE', 'Sebastian rodriguez', '1780695398462-ofqfml.jpg', NULL, 2, '2026-06-05 21:36:38'),
    (4, 'ALCALDE', 'Mario Gonzales', '1780695416299-zji6ab.jpg', NULL, 3, '2026-06-05 21:36:56'),
    (6, 'ALCALDE', 'Paola Rodriguez', '1780695469629-ie1nr3.jpg', NULL, 4, '2026-06-05 21:37:49'),
    (7, 'CONCEJALES_URBANOS', 'Candidato 1', '1780697337835-9vcguk.jpg', NULL, 0, '2026-06-05 22:08:57'),
    (8, 'CONCEJALES_URBANOS', 'Candidato 2', '1780697349682-jebbwx.jpg', NULL, 0, '2026-06-05 22:09:09'),
    (9, 'CONCEJALES_URBANOS', 'Candodato 3', '1780697363524-ty77gg.jpg', NULL, 0, '2026-06-05 22:09:23'),
    (10, 'CONCEJALES_URBANOS', 'Candidato 4', '1780697379993-ce3rhj.jpg', NULL, 0, '2026-06-05 22:09:39'),
    (11, 'CONCEJALES_URBANOS', 'Candidato 5', '1780697395678-3rlfpy.jpg', NULL, 0, '2026-06-05 22:09:55'),
    (12, 'CONCEJALES_RURALES', 'rural 1', '1780697571198-96ybke.jpg', NULL, 0, '2026-06-05 22:12:51'),
    (13, 'CONCEJALES_RURALES', 'rural 2', '1780697583663-akt71z.jpg', NULL, 0, '2026-06-05 22:13:03'),
    (14, 'CONCEJALES_RURALES', 'rural 3', '1780697598119-4pv2j0.jpg', NULL, 0, '2026-06-05 22:13:18'),
    (15, 'CONCEJALES_RURALES', 'rural 4', '1780697609604-ccz3a3.jpg', NULL, 0, '2026-06-05 22:13:29'),
    (16, 'CONCEJALES_RURALES', 'rural 5', '1780697622618-f98zh2.jpg', NULL, 0, '2026-06-05 22:13:42'),
    (17, 'JUNTAS_PARROQUIALES', 'junta 1', '1780697644395-n84opw.jpg', NULL, 0, '2026-06-05 22:14:04'),
    (18, 'JUNTAS_PARROQUIALES', 'junta 2', '1780697656893-53ivuj.jpg', NULL, 0, '2026-06-05 22:14:17'),
    (19, 'JUNTAS_PARROQUIALES', 'junta 3', '1780697672191-pmky7g.jpg', NULL, 0, '2026-06-05 22:14:32'),
    (20, 'JUNTAS_PARROQUIALES', 'junta 4', '1780697682925-j2uv7r.jpg', NULL, 0, '2026-06-05 22:14:42'),
    (21, 'JUNTAS_PARROQUIALES', 'junta 5', '1780697695930-qb96qk.jpg', NULL, 0, '2026-06-05 22:14:55');

-- Resetear secuencia de candidatos
SELECT setval('candidatos_id_seq', (SELECT MAX(id) FROM candidatos));

-- Datos de preguntas
INSERT INTO preguntas (id, pregunta, activa, orden, created_at) VALUES
    (1, 'Considera que la administracion actual ha sido buena', TRUE, 0, '2026-06-05 00:54:39'),
    (2, 'Considera que la seguridad en la ultima administracion fue buena', TRUE, 0, '2026-06-05 00:54:39'),
    (3, 'Considera que las vias en sucua son buenas', TRUE, 0, '2026-06-05 23:33:37'),
    (4, 'Considera que el agua potable en Sucua es manejada adecuadamente', TRUE, 0, '2026-06-05 23:34:35'),
    (5, 'Considera que la Salud en Sucua es la adecuada', TRUE, 0, '2026-06-05 23:35:13');

SELECT setval('preguntas_id_seq', (SELECT MAX(id) FROM preguntas));
