import type { Pool } from 'pg';

/**
 * Etapa I — CIE Readiness: repositorio de compliance documental.
 *
 * Este módulo entrega lo que el contrato firmado exige para la Etapa I: un
 * repositorio de evidencia y un checklist de estado documental con semáforo.
 * Es información **binaria de estado** —qué evidencia existe y cuál falta—,
 * no analítica de indicadores: los volúmenes, tasas y tendencias son Etapa V.
 *
 * Convive con la tabla preexistente `compliance_records` (módulo syllabus),
 * que es una lista de estado mantenida a mano por área (FERPA, IPEDS, WCAG…).
 * Esa tabla NO se toca: resuelve otro problema. El checklist de la CIE se
 * resuelve con consultas de existencia sobre `cie_documents`.
 *
 * Convención de IDs: igual que el resto de los módulos de esta rama, las PKs
 * son `TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT` — Postgres genera el
 * id, no la aplicación. Así se pueden declarar FKs reales contra las tablas
 * preexistentes (`tenants`, `degree_programs`).
 *
 * Programas: se reutiliza `degree_programs` (ya existente en `db.ts`). No se
 * crea una tabla de programas propia: habría dos catálogos del mismo concepto
 * y el checklist contaría mal. `degree_programs.is_active` es el booleano que
 * decide qué programas exigen evidencia.
 */
export async function migrateCie(pool: Pool): Promise<void> {
  await pool.query(`
    -- Catálogo de evidencia exigida. El cliente lo edita desde el panel: la
    -- CIE puede pedir piezas adicionales sin que haya que tocar código.
    CREATE TABLE IF NOT EXISTS cie_document_types (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      code TEXT NOT NULL UNIQUE,
      name_es TEXT NOT NULL,
      name_en TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('institutional','program','faculty')),
      -- true si la CIE exige esta evidencia para la solicitud de licencia.
      -- El resumen y el semáforo global miden SOLO estos tipos.
      cie_required BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      help_es TEXT,
      help_en TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS cie_document_types_scope_idx
      ON cie_document_types(scope, display_order, code);
    CREATE INDEX IF NOT EXISTS cie_document_types_tenant_idx ON cie_document_types(tenant_id);

    -- Expedientes de faculty. Nombre sin prefijo cie_ por pedido explícito
    -- del contrato: el expediente docente es un objeto del dominio, no un
    -- artefacto del checklist.
    CREATE TABLE IF NOT EXISTS faculty_records (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      program_id TEXT REFERENCES degree_programs(id) ON DELETE SET NULL,
      credentials TEXT,
      -- Vocabulario alineado con degree_programs.degree_level de esta rama
      -- ('doctoral'/'professional'), más 'other' para grados fuera de catálogo.
      degree_level TEXT CHECK (degree_level IN ('bachelor','master','doctoral','professional','other')),
      timezone TEXT,
      office_hours TEXT,
      zoom_booking_url TEXT,
      bio_es TEXT,
      bio_en TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','candidate')),
      moodle_user_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Unicidad insensible a mayúsculas: el correo es la identidad del docente
    -- y "A@x.com" no debe poder cargarse dos veces con distinta caja.
    CREATE UNIQUE INDEX IF NOT EXISTS faculty_records_email_unique_idx
      ON faculty_records(LOWER(email));
    CREATE INDEX IF NOT EXISTS faculty_records_status_idx ON faculty_records(status, full_name);
    CREATE INDEX IF NOT EXISTS faculty_records_program_idx ON faculty_records(program_id);
    CREATE INDEX IF NOT EXISTS faculty_records_tenant_idx ON faculty_records(tenant_id);

    -- El repositorio en sí. Un documento cuelga de exactamente un ámbito:
    -- la institución (ambas columnas nulas), un programa, o un docente.
    CREATE TABLE IF NOT EXISTS cie_documents (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      document_type_id TEXT NOT NULL REFERENCES cie_document_types(id) ON DELETE CASCADE,
      program_id TEXT REFERENCES degree_programs(id) ON DELETE CASCADE,
      faculty_id TEXT REFERENCES faculty_records(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_url TEXT,
      version TEXT NOT NULL DEFAULT '1',
      -- 'approved' es el único estado que cuenta como evidencia completa.
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','rejected')),
      effective_date DATE,
      expires_at DATE,
      notes TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      -- Un documento no puede pertenecer a un programa y a un docente a la
      -- vez: si pudiera, el checklist lo contaría dos veces y el semáforo
      -- mentiría.
      CONSTRAINT cie_documents_single_scope CHECK (
        program_id IS NULL OR faculty_id IS NULL
      )
    );
    CREATE INDEX IF NOT EXISTS cie_documents_type_idx ON cie_documents(document_type_id, status);
    CREATE INDEX IF NOT EXISTS cie_documents_program_idx ON cie_documents(program_id);
    CREATE INDEX IF NOT EXISTS cie_documents_faculty_idx ON cie_documents(faculty_id);
    CREATE INDEX IF NOT EXISTS cie_documents_tenant_idx ON cie_documents(tenant_id);
    CREATE INDEX IF NOT EXISTS cie_documents_expiry_idx ON cie_documents(expires_at)
      WHERE expires_at IS NOT NULL;

    -- Formulario de contacto de la web pública.
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      program_id TEXT REFERENCES degree_programs(id) ON DELETE SET NULL,
      subject TEXT,
      message TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'es',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed','spam')),
      source TEXT NOT NULL DEFAULT 'public-web',
      handled_by TEXT,
      handled_at TIMESTAMPTZ,
      remote_ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS contact_messages_status_idx
      ON contact_messages(status, created_at DESC);
    -- Índice del límite anti-abuso por IP: la consulta filtra por remote_ip
    -- y una ventana reciente de created_at.
    CREATE INDEX IF NOT EXISTS contact_messages_throttle_idx
      ON contact_messages(remote_ip, created_at DESC);
  `);

  // Unicidad por unidad: no puede haber dos documentos del mismo tipo para la
  // misma unidad (la institución, un programa, un docente). Son índices
  // parciales porque la "unidad institucional" se representa con ambas FKs
  // nulas, y un UNIQUE normal no distingue nulos.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cie_documents_institutional_unique_idx
      ON cie_documents(document_type_id)
      WHERE program_id IS NULL AND faculty_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS cie_documents_program_unique_idx
      ON cie_documents(document_type_id, program_id)
      WHERE program_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS cie_documents_faculty_unique_idx
      ON cie_documents(document_type_id, faculty_id)
      WHERE faculty_id IS NOT NULL;
  `);

  await seedCieDocumentTypes(pool);
}

type SeedDocumentType = {
  code: string;
  nameEs: string;
  nameEn: string;
  scope: 'institutional' | 'program' | 'faculty';
  cieRequired: boolean;
  displayOrder: number;
  helpEs: string;
  helpEn: string;
};

/**
 * Catálogo inicial de evidencia documental de la CIE. Punto de partida
 * editable desde el panel admin.
 */
const SEED_DOCUMENT_TYPES: SeedDocumentType[] = [
  {
    code: 'INST_CATALOG',
    nameEs: 'Catálogo institucional',
    nameEn: 'Institutional catalog',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 10,
    helpEs: 'Catálogo vigente con programas, requisitos de admisión, costos y calendario.',
    helpEn: 'Current catalog with programs, admission requirements, tuition and calendar.'
  },
  {
    code: 'INST_MISSION',
    nameEs: 'Misión y objetivos institucionales',
    nameEn: 'Institutional mission and objectives',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 20,
    helpEs: 'Declaración de misión aprobada por el órgano de gobierno.',
    helpEn: 'Mission statement approved by the governing body.'
  },
  {
    code: 'INST_GOVERNANCE',
    nameEs: 'Estatutos y estructura de gobierno',
    nameEn: 'Bylaws and governance structure',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 30,
    helpEs: 'Estatutos, organigrama y actas de constitución del órgano de gobierno.',
    helpEn: 'Bylaws, org chart and incorporation records of the governing body.'
  },
  {
    code: 'INST_ADMISSIONS_POLICY',
    nameEs: 'Política de admisiones',
    nameEn: 'Admissions policy',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 40,
    helpEs: 'Criterios de admisión, documentos exigidos y proceso de apelación.',
    helpEn: 'Admission criteria, required documents and appeal process.'
  },
  {
    code: 'INST_GRADING_POLICY',
    nameEs: 'Política de calificación y progreso académico',
    nameEn: 'Grading and academic progress policy',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 50,
    helpEs:
      'Escala de calificación, mínimo de aprobación por nivel y política de progreso satisfactorio.',
    helpEn: 'Grading scale, passing minimum per level and satisfactory progress policy.'
  },
  {
    code: 'INST_STUDENT_HANDBOOK',
    nameEs: 'Manual del estudiante',
    nameEn: 'Student handbook',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 60,
    helpEs: 'Derechos, deberes, conducta académica y servicios al estudiante.',
    helpEn: 'Rights, duties, academic conduct and student services.'
  },
  {
    code: 'INST_GRIEVANCE_POLICY',
    nameEs: 'Política de quejas y reclamos',
    nameEn: 'Grievance and complaint policy',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 70,
    helpEs: 'Procedimiento formal de queja, plazos y escalamiento.',
    helpEn: 'Formal complaint procedure, deadlines and escalation path.'
  },
  {
    code: 'INST_PRIVACY_FERPA',
    nameEs: 'Política de privacidad y FERPA',
    nameEn: 'Privacy and FERPA policy',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 80,
    helpEs: 'Tratamiento de expedientes del estudiante conforme a FERPA.',
    helpEn: 'Handling of student records in accordance with FERPA.'
  },
  {
    code: 'INST_FINANCIAL_STATEMENTS',
    nameEs: 'Estados financieros',
    nameEn: 'Financial statements',
    scope: 'institutional',
    cieRequired: true,
    displayOrder: 90,
    helpEs: 'Estados financieros del último periodo y proyección de sostenibilidad.',
    helpEn: 'Latest-period financial statements and sustainability projection.'
  },
  {
    code: 'INST_FACILITIES',
    nameEs: 'Instalaciones y recursos de aprendizaje',
    nameEn: 'Facilities and learning resources',
    scope: 'institutional',
    cieRequired: false,
    displayOrder: 100,
    helpEs: 'Descripción de sede, biblioteca digital y recursos tecnológicos.',
    helpEn: 'Description of premises, digital library and technology resources.'
  },
  {
    code: 'PROG_MASTER_SYLLABUS',
    nameEs: 'Master Syllabus del programa',
    nameEn: 'Program Master Syllabus',
    scope: 'program',
    cieRequired: true,
    displayOrder: 110,
    helpEs: 'Plantilla institucional de 24 secciones aplicada al programa. Base de la Etapa II.',
    helpEn: '24-section institutional template applied to the program. Basis for Etapa II.'
  },
  {
    code: 'PROG_CURRICULUM_MAP',
    nameEs: 'Malla curricular',
    nameEn: 'Curriculum map',
    scope: 'program',
    cieRequired: true,
    displayOrder: 120,
    helpEs: 'Secuencia de cursos, créditos y prerrequisitos.',
    helpEn: 'Course sequence, credits and prerequisites.'
  },
  {
    code: 'PROG_LEARNING_OUTCOMES',
    nameEs: 'Resultados de aprendizaje del programa',
    nameEn: 'Program learning outcomes',
    scope: 'program',
    cieRequired: true,
    displayOrder: 130,
    helpEs: 'Resultados medibles y su alineación con las competencias del egresado.',
    helpEn: 'Measurable outcomes and their alignment with graduate competencies.'
  },
  {
    code: 'PROG_APPROVAL_RECORD',
    nameEs: 'Acta de aprobación del programa',
    nameEn: 'Program approval record',
    scope: 'program',
    cieRequired: true,
    displayOrder: 140,
    helpEs: 'Acta del comité académico que aprueba el programa y su versión vigente.',
    helpEn: 'Academic committee record approving the program and its current version.'
  },
  {
    code: 'FAC_CV',
    nameEs: 'Hoja de vida',
    nameEn: 'Curriculum vitae',
    scope: 'faculty',
    cieRequired: true,
    displayOrder: 150,
    helpEs: 'CV firmado y fechado del docente.',
    helpEn: 'Signed and dated faculty CV.'
  },
  {
    code: 'FAC_DEGREE_TRANSCRIPT',
    nameEs: 'Título y notas del grado máximo',
    nameEn: 'Highest degree diploma and transcript',
    scope: 'faculty',
    cieRequired: true,
    displayOrder: 160,
    helpEs: 'Diploma y certificado de notas oficiales del grado más alto obtenido.',
    helpEn: 'Diploma and official transcript for the highest degree earned.'
  },
  {
    code: 'FAC_CREDENTIAL_VERIFICATION',
    nameEs: 'Verificación de credenciales',
    nameEn: 'Credential verification',
    scope: 'faculty',
    cieRequired: true,
    displayOrder: 170,
    helpEs: 'Evaluación de equivalencia para títulos obtenidos fuera de Estados Unidos.',
    helpEn: 'Equivalency evaluation for degrees earned outside the United States.'
  },
  {
    code: 'FAC_AGREEMENT',
    nameEs: 'Contrato o carta de vinculación',
    nameEn: 'Faculty agreement or appointment letter',
    scope: 'faculty',
    cieRequired: true,
    displayOrder: 180,
    helpEs: 'Contrato suscrito con la descripción del cargo y la carga académica.',
    helpEn: 'Signed agreement including job description and teaching load.'
  },
  {
    code: 'FAC_PROFESSIONAL_LICENSE',
    nameEs: 'Licencia profesional',
    nameEn: 'Professional license',
    scope: 'faculty',
    cieRequired: false,
    displayOrder: 190,
    helpEs: 'Solo para programas cuyo ejercicio exige licencia vigente.',
    helpEn: 'Only for programs whose practice requires a current license.'
  }
];

/**
 * Siembra el catálogo base si falta. `ON CONFLICT (code) DO NOTHING` protege
 * los textos y el orden que el cliente ya haya ajustado: la migración corre
 * en cada arranque y nunca debe pisar sus ediciones.
 */
async function seedCieDocumentTypes(pool: Pool): Promise<void> {
  for (const type of SEED_DOCUMENT_TYPES) {
    await pool.query(
      `INSERT INTO cie_document_types
         (code, name_es, name_en, scope, cie_required, display_order, help_es, help_en, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (code) DO NOTHING`,
      [
        type.code,
        type.nameEs,
        type.nameEn,
        type.scope,
        type.cieRequired,
        type.displayOrder,
        type.helpEs,
        type.helpEn
      ]
    );
  }
}
