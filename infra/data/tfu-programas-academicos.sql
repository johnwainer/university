-- Programas académicos de TFU
--
-- Reemplaza los seis programas de demostración que la instalación siembra por
-- defecto —BBA in Business Administration, BS in Computer Science y demás, con
-- código DEMO-— por la oferta que TFU tiene publicada. Esos seis aparecían en
-- el desplegable «Programa de interés» del formulario público de admisión.
--
-- Los nombres, las áreas y las horas NO se inventan aquí: salen del catálogo
-- publicado (/v1/catalog), que es contenido de TFU.
--
-- Dos decisiones que TFU debe confirmar:
--   · nivel 'certificate' para los trece, por ser certificados profesionales;
--   · credit_hours_required = 0, es decir «sin declarar». Lo que el catálogo
--     da son horas de contacto y no créditos, y convertir unas en otros es una
--     equivalencia académica que sólo la institución puede fijar. La columna
--     alimenta el degree audit de la Etapa III; hasta entonces no se lee.
--
-- Uso:
--   psql -d atlas -f tfu-programas-academicos.sql
--
-- Es idempotente: se puede correr dos veces sin duplicar.

BEGIN;

-- Las cinco áreas del catálogo, como departamentos.
INSERT INTO departments (code, name) VALUES ('TFU-AI', 'IA — Capacidad Transversal')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO departments (code, name) VALUES ('TFU-CX', 'Experiencia del Cliente como Motor de Ingresos')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO departments (code, name) VALUES ('TFU-EDU', 'Transformación Educativa')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO departments (code, name) VALUES ('TFU-LEAD', 'e-Liderazgo y Gestión de Equipos Remotos')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO departments (code, name) VALUES ('TFU-SALES', 'Ventas y Crecimiento de Ingresos')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Los trece programas publicados.
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'De las metas a los resultados: ejecución de equipos potenciada por IA', 'TFU-AI-EXEC', 'certificate', d.id, 0, 'Las prioridades no generan resultados. La ejecución sí. Convierte las prioridades estratégicas en trabajo terminado con responsabilidad clara, flujos más inteligentes e IA práctica que ayuda a los equipos a avanzar más rápido y entregar más. · 6 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-AI'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Liderar el negocio como una sola red', 'TFU-AI-NETWORK', 'certificate', d.id, 0, 'Distintas sedes. Un solo estándar de desempeño. Crea la alineación de liderazgo, la comunicación y la responsabilidad necesarias para operar con consistencia en sucursales, franquicias y unidades de negocio. · 20 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-AI'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'IA en el trabajo: herramientas prácticas para el desempeño del negocio', 'TFU-AI-WORK', 'certificate', d.id, 0, 'Lleva la IA de la experimentación al desempeño medible. Prepara a los equipos para usar la IA con responsabilidad, agilizar el trabajo, aumentar la productividad y crear valor medible en todas las funciones del negocio. · 8 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-AI'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Comunicación e Influencia', 'TFU-CX-COMM', 'certificate', d.id, 0, 'Haz que cada conversación crítica impulse el negocio. Fortalece la claridad, la confianza y la influencia necesarias para navegar conversaciones difíciles, generar alineación, acelerar decisiones y mejorar resultados. · 6 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-CX'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Experiencia del Cliente y Éxito del Cliente', 'TFU-CX-SUCCESS', 'certificate', d.id, 0, 'Convierte la experiencia del cliente en un motor de ingresos. Desarrolla las capacidades para fortalecer relaciones, mejorar la retención, identificar oportunidades de upselling y cross-selling, y aumentar el valor del cliente en el tiempo. · 8 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-CX'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Más allá de la prueba anti-IA: evaluación para el aprendizaje auténtico', 'TFU-EDU-ASSESS', 'certificate', d.id, 0, 'Cuando la IA puede producir la respuesta, la evaluación tiene que revelar el pensamiento. Rediseña la evaluación para que los educadores distingan un producto pulido con IA de la comprensión, el razonamiento, la aplicación y el dominio genuinos. · 16 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-EDU'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Liderar escuelas como una sola red de aprendizaje', 'TFU-EDU-NETWORK', 'certificate', d.id, 0, 'Distintas escuelas. Una dirección. Un solo estándar de aprendizaje. Construye la alineación de liderazgo, la comunicación y la responsabilidad necesarias para fortalecer el desempeño y la consistencia en escuelas, campus y redes de aprendizaje. · 20 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-EDU'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'El recorrido instruccional con IA', 'TFU-EDU-WALK', 'certificate', d.id, 0, 'No busques solo el uso de IA. Busca evidencia de aprendizaje. Prepara a los líderes instruccionales para evaluar cómo se usa la IA, identificar el aprendizaje auténtico, proteger el rigor académico y orientar mejores prácticas docentes. · 16 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-EDU'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Liderar el cambio: de la resistencia a los resultados', 'TFU-LEAD-CHANGE', 'certificate', d.id, 0, 'El cambio solo crea valor cuando las personas lo adoptan. Prepara a los líderes para reducir la resistencia, construir preparación, acelerar la adopción y sostener el desempeño durante el cambio organizacional. · 8 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-LEAD'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Desarrollo de e-Liderazgo', 'TFU-LEAD-ELEAD', 'certificate', d.id, 0, 'La distancia cambia cómo trabajan los equipos. No debería debilitar cómo se lideran. Desarrolla líderes que generen claridad, responsabilidad, conexión y alto desempeño en equipos remotos, distribuidos e híbridos. · 12 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-LEAD'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Desempeño de Equipo y Cultura', 'TFU-LEAD-TEAM', 'certificate', d.id, 0, 'La cultura no es lo que dices. Es cómo se desempeña tu equipo. Convierte los valores en comportamientos cotidianos que fortalecen la colaboración, la responsabilidad, el compromiso y el desempeño consistente del equipo. · 8 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-LEAD'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Excelencia en Ventas', 'TFU-SALES-EXC', 'certificate', d.id, 0, 'Crea más valor. Convierte más oportunidades. Cierra con consistencia. Construye la confianza, la habilidad y la disciplina que tu equipo necesita para liderar mejores conversaciones de venta, manejar la resistencia, mejorar la conversión y elevar el desempeño comercial. · 12 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-SALES'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;
INSERT INTO degree_programs (name, code, degree_level, department_id, credit_hours_required, description)
  SELECT 'Operaciones de Ventas y Optimización de Procesos', 'TFU-SALES-OPS', 'certificate', d.id, 0, 'Construye el sistema de ventas del que depende tu crecimiento. Crea la estructura, los procesos, la visibilidad y la responsabilidad necesarios para mejorar la ejecución, reducir la inconsistencia y lograr ingresos más predecibles. · 8 horas de contacto.'
    FROM departments d WHERE d.code = 'TFU-SALES'
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, degree_level = EXCLUDED.degree_level,
    department_id = EXCLUDED.department_id, description = EXCLUDED.description,
    is_active = true;

-- Los de demostración y los que dejaron las pruebas se desactivan, no se
-- borran: hay postulaciones, mensajes de contacto y documentos CIE que los
-- referencian, y borrarlos dejaría esos registros huérfanos.
UPDATE degree_programs SET is_active = false
 WHERE code LIKE 'DEMO-%' OR code LIKE 'QA%';

COMMIT;

-- Comprobación:
--   SELECT code, name, degree_level, is_active FROM degree_programs ORDER BY is_active DESC, code;
--   curl -s https://api.portal.thefloridianuniversity.com/api/v1/programs
