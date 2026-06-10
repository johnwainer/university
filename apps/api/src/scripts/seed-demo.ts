/**
 * seed-demo.ts — Idempotent demo seed for "Atlas Online University".
 *
 * Fills every intermediator section with believable university demo data so the
 * admin app can be demoed end-to-end. Re-runnable without duplicating: each
 * block deletes its own demo rows (identified by a stable marker) before
 * re-inserting.
 *
 * Markers used to scope demo data (so we never touch pre-existing real rows):
 *   - users / auth / SIS / CRM / credentials / certificates → demo students use
 *     emails ending in `@demo.atlas.edu` (real seeded users use `@atlas.edu`).
 *   - departments / terms / programs → codes prefixed with `DEMO-`.
 *   - staff_directory → external_id prefixed with `demo-staff-`.
 *   - compliance / syllabi / calendar / media → scoped by demo foreign keys
 *     (demo terms/programs/competencies, demo slugs/codes) so user-facing text
 *     stays clean (no visible "[DEMO]" prefix) while re-seeds remain idempotent.
 *
 * Run from repo root:  npx tsx apps/api/src/scripts/seed-demo.ts
 */
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { pool } from '../db.js';

const TENANT_ID = 'tenant-atlas';
const STUDENT_DOMAIN = '@demo.atlas.edu';
const OWNER_EMAIL = 'admissions@atlas.edu';
// Showcase student login handed to demos (has enrollments, ledger, certificates, competencies).
const SHOWCASE_STUDENT_EMAIL = 'estudiante@atlas.edu';
const STUDENT_DEMO_PASSWORD = 'Estudiante2026';

// Moodle course ids actually present in the local DB. Loaded dynamically in
// main() so transcript/certificates/competencies link to real course names
// (the synced Atlas catalog), with a fallback if the catalog is empty.
let DEMO_COURSE_IDS = [3, 4, 5, 6, 7];

type Row = Record<string, unknown>;

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function q(text: string, params: unknown[] = []) {
  return pool.query(text, params);
}

// ---------------------------------------------------------------------------
// 1. Academic structure: departments, terms, programs, calendar
// ---------------------------------------------------------------------------
type SeedDepartment = { id: string; name: string; code: string; description: string; dean: string };
type SeedTerm = { id: string; name: string; code: string; start: string; end: string; active: boolean };
type SeedProgram = {
  id: string;
  name: string;
  code: string;
  level: string;
  deptCode: string;
  credits: number;
  description: string;
};

const departments: SeedDepartment[] = [
  { id: randomUUID(), name: 'School of Business', code: 'DEMO-BUS', description: 'Negocios, administración y emprendimiento.', dean: 'Dr. Laura Mendoza' },
  { id: randomUUID(), name: 'School of Technology', code: 'DEMO-TECH', description: 'Computación, datos e ingeniería de software.', dean: 'Dr. Andrés Ramírez' },
  { id: randomUUID(), name: 'School of Health Sciences', code: 'DEMO-HEALTH', description: 'Enfermería y ciencias de la salud.', dean: 'Dr. Patricia Salinas' },
  { id: randomUUID(), name: 'School of Arts & Humanities', code: 'DEMO-ARTS', description: 'Humanidades, comunicación y artes.', dean: 'Dr. Felipe Cárdenas' },
  { id: randomUUID(), name: 'School of Education', code: 'DEMO-EDU', description: 'Pedagogía y diseño instruccional.', dean: 'Dr. Sofía Herrera' }
];

const terms: SeedTerm[] = [
  { id: randomUUID(), name: 'Fall 2025', code: 'DEMO-2025FA', start: '2025-08-25', end: '2025-12-19', active: false },
  { id: randomUUID(), name: 'Spring 2026', code: 'DEMO-2026SP', start: '2026-01-12', end: '2026-05-08', active: true },
  { id: randomUUID(), name: 'Summer 2026', code: 'DEMO-2026SU', start: '2026-06-01', end: '2026-08-07', active: false }
];

const programs: SeedProgram[] = [
  { id: randomUUID(), name: 'BBA in Business Administration', code: 'DEMO-BBA-BA', level: 'bachelor', deptCode: 'DEMO-BUS', credits: 120, description: 'Licenciatura en administración de empresas.' },
  { id: randomUUID(), name: 'BS in Computer Science', code: 'DEMO-BS-CS', level: 'bachelor', deptCode: 'DEMO-TECH', credits: 120, description: 'Licenciatura en ciencias de la computación.' },
  { id: randomUUID(), name: 'Certificate in Data Analytics', code: 'DEMO-CERT-DA', level: 'certificate', deptCode: 'DEMO-TECH', credits: 18, description: 'Certificado profesional en analítica de datos.' },
  { id: randomUUID(), name: 'BS in Nursing', code: 'DEMO-BS-NUR', level: 'bachelor', deptCode: 'DEMO-HEALTH', credits: 124, description: 'Licenciatura en enfermería (BSN).' },
  { id: randomUUID(), name: 'Certificate in Instructional Design', code: 'DEMO-CERT-ID', level: 'certificate', deptCode: 'DEMO-EDU', credits: 15, description: 'Certificado en diseño instruccional.' },
  { id: randomUUID(), name: 'MA in Digital Communication', code: 'DEMO-MA-DC', level: 'master', deptCode: 'DEMO-ARTS', credits: 36, description: 'Maestría en comunicación digital.' }
];

function deptId(code: string): string {
  return departments.find((d) => d.code === code)!.id;
}

async function seedAcademicStructure(): Promise<void> {
  // Clean demo rows (children first thanks to ON DELETE cascade where present).
  await q(
    `DELETE FROM academic_calendar WHERE term_id IN (SELECT id FROM academic_terms WHERE code LIKE 'DEMO-%')`
  );
  await q(`DELETE FROM degree_programs WHERE code LIKE 'DEMO-%'`);
  await q(`DELETE FROM academic_terms WHERE code LIKE 'DEMO-%'`);
  await q(`DELETE FROM departments WHERE code LIKE 'DEMO-%'`);

  for (const d of departments) {
    await q(
      `INSERT INTO departments (id, name, code, description, dean_name) VALUES ($1,$2,$3,$4,$5)`,
      [d.id, d.name, d.code, d.description, d.dean]
    );
  }
  for (const t of terms) {
    await q(
      `INSERT INTO academic_terms (id, name, code, start_date, end_date, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.id, t.name, t.code, t.start, t.end, t.active]
    );
  }
  for (const p of programs) {
    await q(
      `INSERT INTO degree_programs (id, name, code, degree_level, department_id, credit_hours_required, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.id, p.name, p.code, p.level, deptId(p.deptCode), p.credits, p.description]
    );
  }

  // Academic calendar: 5-8 events per term.
  const events: Array<[string, string, string]> = [];
  const tplFall: Array<[string, string]> = [
    ['Inicio de clases', '2025-08-25'],
    ['Fin de periodo de ajustes (add/drop)', '2025-09-05'],
    ['Receso de medio término', '2025-10-13'],
    ['Última fecha de retiro', '2025-11-07'],
    ['Receso de Acción de Gracias', '2025-11-27'],
    ['Semana de exámenes finales', '2025-12-15'],
    ['Fin de semestre', '2025-12-19']
  ];
  const tplSpring: Array<[string, string]> = [
    ['Inicio de clases', '2026-01-12'],
    ['Fin de periodo de ajustes (add/drop)', '2026-01-23'],
    ['Receso de primavera', '2026-03-16'],
    ['Última fecha de retiro', '2026-04-03'],
    ['Semana de exámenes finales', '2026-05-04'],
    ['Graduación', '2026-05-09'],
    ['Fin de semestre', '2026-05-08']
  ];
  const tplSummer: Array<[string, string]> = [
    ['Inicio de clases (sesión intensiva)', '2026-06-01'],
    ['Fin de periodo de ajustes (add/drop)', '2026-06-05'],
    ['Día feriado (Juneteenth)', '2026-06-19'],
    ['Última fecha de retiro', '2026-07-10'],
    ['Exámenes finales', '2026-08-05'],
    ['Fin de sesión de verano', '2026-08-07']
  ];
  for (const [name, date] of tplFall) events.push([terms[0].id, name, date]);
  for (const [name, date] of tplSpring) events.push([terms[1].id, name, date]);
  for (const [name, date] of tplSummer) events.push([terms[2].id, name, date]);

  for (const [termId, name, date] of events) {
    const category = name.toLowerCase().includes('exámen')
      ? 'exams'
      : name.toLowerCase().includes('receso') || name.toLowerCase().includes('feriado')
        ? 'holiday'
        : name.toLowerCase().includes('graduación')
          ? 'ceremony'
          : 'academic';
    await q(
      `INSERT INTO academic_calendar (tenant_id, term_id, event_name, event_date, category)
       VALUES ($1,$2,$3,$4,$5)`,
      [TENANT_ID, termId, name, date, category]
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Students (users + public_user_auth)
// ---------------------------------------------------------------------------
type SeedStudent = {
  id: string;
  fullName: string;
  email: string;
  locale: string;
  programCode: string;
};

const studentNames = [
  'Carlos Jiménez',
  'Ana Lucía Torres',
  'Miguel Ángel Ruiz',
  'Valentina Castro',
  'Diego Fernández',
  'Camila Restrepo',
  'Sebastián Morales',
  'Isabella Vargas',
  'Mateo Guerrero',
  'Lucía Navarro'
];

const students: SeedStudent[] = studentNames.map((name, i) => {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return {
    id: randomUUID(),
    fullName: name,
    // First student is the showcase login handed to demos (clean @atlas.edu email).
    email: i === 0 ? SHOWCASE_STUDENT_EMAIL : `${slug}${STUDENT_DOMAIN}`,
    locale: i % 3 === 0 ? 'en' : 'es',
    programCode: pick(programs, i).code
  };
});

// Real scrypt hash matching the API's verifyPassword (`salt:hash`), so demo
// students can actually log in to the public student portal.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function seedStudents(): Promise<void> {
  // public_user_auth + downstream rows cascade on users delete. Scope by demo
  // domain plus the explicit showcase email so re-seeds stay idempotent without
  // touching pre-existing real @atlas.edu users.
  await q(`DELETE FROM users WHERE email LIKE $1 OR email = $2`, [`%${STUDENT_DOMAIN}`, SHOWCASE_STUDENT_EMAIL]);

  for (const s of students) {
    await q(
      `INSERT INTO users (id, full_name, email, locale, roles, tenant_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [s.id, s.fullName, s.email, s.locale, ['learner'], TENANT_ID]
    );
    await q(
      `INSERT INTO public_user_auth (user_id, password_hash) VALUES ($1,$2)`,
      [s.id, hashPassword(STUDENT_DEMO_PASSWORD)]
    );
  }
}

function programId(code: string): string {
  return programs.find((p) => p.code === code)!.id;
}

// ---------------------------------------------------------------------------
// 3. SIS: admissions, enrollments, ledger, invoices, payments, aid,
//    requirements, holds
// ---------------------------------------------------------------------------
const STAGES = ['lead', 'applied', 'admitted', 'enrolled', 'rejected'] as const;

// Map: the first 6 students are "enrolled" applicants; rest spread elsewhere.
async function seedSis(): Promise<{ enrolledStudents: SeedStudent[] }> {
  // Clean (most cascade via users delete, but admissions/calendar use marker).
  await q(`DELETE FROM admissions_applications WHERE email LIKE $1`, [`%${STUDENT_DOMAIN}`]);
  // ledger/invoices/payments/aid/holds/enrollments cascade with users, already
  // cleared in seedStudents. degree_requirements cascade with degree_programs.
  await q(
    `DELETE FROM degree_requirements WHERE degree_program_id IN (SELECT id FROM degree_programs WHERE code LIKE 'DEMO-%')`
  );

  const enrolledStudents = students.slice(0, 6);

  // 12 admissions applications spread across stages.
  const apps: Array<{ name: string; email: string; stage: string; programCode: string }> = [];
  // 6 enrolled applicants map to the enrolled students (same email/name).
  enrolledStudents.forEach((s) => {
    apps.push({ name: s.fullName, email: s.email, stage: 'enrolled', programCode: s.programCode });
  });
  // 6 prospective applicants (not real users) across remaining stages.
  const prospects = [
    { name: 'Gabriel Soto', stage: 'lead' },
    { name: 'Mariana Pineda', stage: 'lead' },
    { name: 'Tomás Aguilar', stage: 'applied' },
    { name: 'Renata Cordero', stage: 'applied' },
    { name: 'Joaquín Vega', stage: 'admitted' },
    { name: 'Daniela Rojas', stage: 'rejected' }
  ];
  prospects.forEach((p, i) => {
    const slug = p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
    apps.push({
      name: p.name,
      email: `${slug}${STUDENT_DOMAIN}`,
      stage: p.stage,
      programCode: pick(programs, i + 2).code
    });
  });

  for (const a of apps) {
    await q(
      `INSERT INTO admissions_applications (tenant_id, full_name, email, phone, program_id, stage, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        TENANT_ID,
        a.name,
        a.email,
        '+57 300 000 0000',
        programId(a.programCode),
        a.stage,
        a.stage === 'rejected' ? 'closed' : 'open',
        `Solicitud de admisión (${a.stage}).`
      ]
    );
  }

  // Enrollments for enrolled students: 2 courses each in the active term.
  const activeTerm = terms[1];
  for (let i = 0; i < enrolledStudents.length; i++) {
    const s = enrolledStudents[i];
    const courseA = DEMO_COURSE_IDS[i % DEMO_COURSE_IDS.length];
    const courseB = DEMO_COURSE_IDS[(i + 1) % DEMO_COURSE_IDS.length];
    for (const courseId of [courseA, courseB]) {
      await q(
        `INSERT INTO student_enrollments (user_id, term_id, moodle_course_id, degree_program_id, status, credit_hours)
         VALUES ($1,$2,$3,$4,'enrolled',3)
         ON CONFLICT (user_id, term_id, moodle_course_id) DO NOTHING`,
        [s.id, activeTerm.id, courseId, programId(s.programCode)]
      );
    }
  }

  // Student ledger: tuition charge + partial payment + aid → running balance.
  for (let i = 0; i < enrolledStudents.length; i++) {
    const s = enrolledStudents[i];
    const tuition = 450000; // $4,500.00
    let balance = 0;
    balance += tuition;
    await q(
      `INSERT INTO student_ledger (tenant_id, student_user_id, term_id, kind, description, amount_cents, balance_cents)
       VALUES ($1,$2,$3,'charge',$4,$5,$6)`,
      [TENANT_ID, s.id, activeTerm.id, 'Matrícula Spring 2026', tuition, balance]
    );
    const payment = i % 2 === 0 ? 200000 : 450000; // partial or full
    balance -= payment;
    await q(
      `INSERT INTO student_ledger (tenant_id, student_user_id, term_id, kind, description, amount_cents, balance_cents)
       VALUES ($1,$2,$3,'payment',$4,$5,$6)`,
      [TENANT_ID, s.id, activeTerm.id, 'Pago de matrícula', -payment, balance]
    );
    if (i < 3) {
      const aid = 100000;
      balance -= aid;
      await q(
        `INSERT INTO student_ledger (tenant_id, student_user_id, term_id, kind, description, amount_cents, balance_cents)
         VALUES ($1,$2,$3,'aid',$4,$5,$6)`,
        [TENANT_ID, s.id, activeTerm.id, 'Beca de mérito', -aid, balance]
      );
    }
  }

  // Invoices (6-8, mix open/paid).
  const invoiceIds: string[] = [];
  for (let i = 0; i < enrolledStudents.length; i++) {
    const s = enrolledStudents[i];
    const status = i % 2 === 0 ? 'open' : 'paid';
    const res = await q(
      `INSERT INTO invoices (tenant_id, student_user_id, term_id, status, total_cents, due_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [TENANT_ID, s.id, activeTerm.id, status, 450000, '2026-02-15']
    );
    invoiceIds.push((res.rows[0] as Row).id as string);
  }

  // Payments (succeeded/pending, stripe/manual).
  for (let i = 0; i < enrolledStudents.length; i++) {
    const s = enrolledStudents[i];
    const status = i % 3 === 0 ? 'pending' : 'succeeded';
    const method = i % 2 === 0 ? 'stripe' : 'manual';
    await q(
      `INSERT INTO payments (tenant_id, invoice_id, student_user_id, amount_cents, status, method, stripe_payment_intent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        TENANT_ID,
        invoiceIds[i],
        s.id,
        i % 2 === 0 ? 200000 : 450000,
        status,
        method,
        method === 'stripe' ? `pi_demo_${s.id.slice(0, 8)}` : null
      ]
    );
  }

  // Financial aid (3-4 scholarships).
  const aidKinds = ['scholarship', 'grant', 'scholarship', 'work_study'];
  for (let i = 0; i < 4; i++) {
    const s = enrolledStudents[i];
    await q(
      `INSERT INTO financial_aid (tenant_id, student_user_id, term_id, kind, amount_cents, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        TENANT_ID,
        s.id,
        activeTerm.id,
        aidKinds[i],
        100000 + i * 25000,
        i % 2 === 0 ? 'awarded' : 'pending',
        `${aidKinds[i]} para ${s.fullName}.`
      ]
    );
  }

  // Degree requirements per program (mix course/credits/gpa).
  for (const p of programs) {
    await q(
      `INSERT INTO degree_requirements (tenant_id, degree_program_id, requirement_type, credits_required, description)
       VALUES ($1,$2,'credits',$3,$4)`,
      [TENANT_ID, p.id, p.credits, `Total de créditos requeridos para ${p.name}.`]
    );
    await q(
      `INSERT INTO degree_requirements (tenant_id, degree_program_id, requirement_type, min_gpa, description)
       VALUES ($1,$2,'gpa',2.0,$3)`,
      [TENANT_ID, p.id, `GPA mínimo de graduación para ${p.name}.`]
    );
    await q(
      `INSERT INTO degree_requirements (tenant_id, degree_program_id, requirement_type, moodle_course_id, description)
       VALUES ($1,$2,'course',$3,$4)`,
      [TENANT_ID, p.id, DEMO_COURSE_IDS[0], `Curso obligatorio para ${p.name}.`]
    );
  }

  // Enrollment holds (2-3, some active).
  const holdSpecs: Array<{ student: SeedStudent; type: string; active: boolean; reason: string }> = [
    { student: enrolledStudents[0], type: 'financial', active: true, reason: 'Saldo pendiente de matrícula.' },
    { student: enrolledStudents[1], type: 'documents', active: true, reason: 'Faltan documentos de admisión.' },
    { student: enrolledStudents[2], type: 'documents', active: false, reason: 'Documentos verificados.' }
  ];
  for (const h of holdSpecs) {
    await q(
      `INSERT INTO enrollment_holds (tenant_id, student_user_id, hold_type, reason, active, released_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [TENANT_ID, h.student.id, h.type, h.reason, h.active, h.active ? null : new Date().toISOString()]
    );
  }

  return { enrolledStudents };
}

// ---------------------------------------------------------------------------
// 4. CRM: contacts, activities, early alerts (reuse existing stages)
// ---------------------------------------------------------------------------
async function seedCrm(): Promise<void> {
  await q(`DELETE FROM crm_contacts WHERE email LIKE '%@prospect.demo.atlas.edu'`);
  await q(
    `DELETE FROM early_alerts WHERE signal IN ('login_gap_14d','grade_below_70','late_submission','financial_hold','no_activity_7d')`
  );

  const stagesRes = await q(`SELECT id, name FROM crm_pipeline_stages ORDER BY sort_order`);
  let stages = stagesRes.rows as Array<{ id: string; name: string }>;
  if (stages.length === 0) {
    await q(
      `INSERT INTO crm_pipeline_stages (name, sort_order, is_won, is_lost) VALUES
       ('Lead',0,false,false),('Contacted',1,false,false),('Application',2,false,false),
       ('Admitted',3,false,false),('Enrolled',4,true,false),('Lost',5,false,true)`
    );
    stages = (await q(`SELECT id, name FROM crm_pipeline_stages ORDER BY sort_order`)).rows as Array<{
      id: string;
      name: string;
    }>;
  }

  const sources = ['web', 'referral', 'webinar', 'paid_ads', 'organic'];
  const contactNames = [
    'Patricia Lemus',
    'Ricardo Ávila',
    'Sandra Quintero',
    'Esteban Lozano',
    'Verónica Mejía',
    'Andrés Cuadros',
    'Natalia Bermúdez',
    'Felipe Ocampo',
    'Carolina Duarte',
    'Julián Espinoza',
    'Adriana Calle',
    'Óscar Mora',
    'Liliana Páez',
    'Camilo Restrepo',
    'Paula Andrea Gil'
  ];

  const contactIds: string[] = [];
  for (let i = 0; i < contactNames.length; i++) {
    const name = contactNames[i];
    const stage = pick(stages, i);
    const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
    // Link some contacts to enrolled students.
    const linkedStudent = i < students.length ? students[i] : null;
    const res = await q(
      `INSERT INTO crm_contacts
        (full_name, email, phone, source, stage_id, owner_email, lead_score, status, notes, student_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        name,
        `${slug}@prospect.demo.atlas.edu`,
        '+57 310 000 0000',
        pick(sources, i),
        stage.id,
        OWNER_EMAIL,
        20 + ((i * 7) % 80),
        'active',
        `Contacto en etapa ${stage.name}.`,
        linkedStudent && i % 3 === 0 ? linkedStudent.id : null
      ]
    );
    contactIds.push((res.rows[0] as Row).id as string);
  }

  // Activities: 2-3 for several contacts.
  const kinds = ['note', 'email', 'call', 'task'];
  for (let i = 0; i < contactIds.length; i++) {
    if (i % 2 !== 0) continue; // ~half the contacts get activity
    const count = 2 + (i % 2);
    for (let j = 0; j < count; j++) {
      const kind = pick(kinds, i + j);
      await q(
        `INSERT INTO crm_activities (contact_id, kind, subject, body, completed)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          contactIds[i],
          kind,
          `${kind} de seguimiento`,
          `Registro de ${kind} con el prospecto.`,
          kind === 'task' ? false : true
        ]
      );
    }
  }

  // Early alerts (4-5, varied severity, some resolved).
  const alertSpecs: Array<{ student: SeedStudent; severity: string; reason: string; signal: string; resolved: boolean }> = [
    { student: students[0], severity: 'high', reason: 'Baja participación en el curso.', signal: 'login_gap_14d', resolved: false },
    { student: students[1], severity: 'medium', reason: 'Calificación baja en evaluación parcial.', signal: 'grade_below_70', resolved: false },
    { student: students[2], severity: 'low', reason: 'Entrega tardía de tarea.', signal: 'late_submission', resolved: true },
    { student: students[3], severity: 'high', reason: 'Saldo financiero pendiente.', signal: 'financial_hold', resolved: false },
    { student: students[4], severity: 'medium', reason: 'Inactividad en plataforma.', signal: 'no_activity_7d', resolved: true }
  ];
  for (const a of alertSpecs) {
    await q(
      `INSERT INTO early_alerts (student_user_id, severity, reason, signal, resolved, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.student.id, a.severity, a.reason, a.signal, a.resolved, a.resolved ? new Date().toISOString() : null]
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Credentials: competencies, badges, progress, certificates
// ---------------------------------------------------------------------------
async function seedCredentials(): Promise<void> {
  // badges.competency_id is ON DELETE SET NULL (not CASCADE), so delete badges
  // explicitly by their demo marker before dropping competencies.
  await q(
    `DELETE FROM badges WHERE competency_id IN (SELECT id FROM competencies WHERE code LIKE 'DEMO-%')`
  );
  await q(`DELETE FROM competencies WHERE code LIKE 'DEMO-%'`); // cascades progress
  await q(`DELETE FROM certificates WHERE serial LIKE 'ATLAS-DEMO-%'`);

  const compSpecs: Array<{ name: string; code: string; programCode: string; courseId: number }> = [
    { name: 'Pensamiento analítico de negocios', code: 'DEMO-COMP-BA', programCode: 'DEMO-BBA-BA', courseId: 3 },
    { name: 'Programación orientada a objetos', code: 'DEMO-COMP-OOP', programCode: 'DEMO-BS-CS', courseId: 4 },
    { name: 'Estructuras de datos', code: 'DEMO-COMP-DS', programCode: 'DEMO-BS-CS', courseId: 5 },
    { name: 'Visualización de datos', code: 'DEMO-COMP-VIZ', programCode: 'DEMO-CERT-DA', courseId: 6 },
    { name: 'Cuidado clínico fundamental', code: 'DEMO-COMP-CLIN', programCode: 'DEMO-BS-NUR', courseId: 7 },
    { name: 'Diseño de experiencias de aprendizaje', code: 'DEMO-COMP-LXD', programCode: 'DEMO-CERT-ID', courseId: 3 },
    { name: 'Comunicación digital estratégica', code: 'DEMO-COMP-DC', programCode: 'DEMO-MA-DC', courseId: 4 },
    { name: 'Gestión ágil de proyectos', code: 'DEMO-COMP-AGILE', programCode: 'DEMO-BBA-BA', courseId: 5 }
  ];

  const compIds: Array<{ id: string; programCode: string }> = [];
  for (const c of compSpecs) {
    const res = await q(
      `INSERT INTO competencies (name, code, description, moodle_course_id, degree_program_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [c.name, c.code, `Competencia: ${c.name}.`, c.courseId, programId(c.programCode)]
    );
    compIds.push({ id: (res.rows[0] as Row).id as string, programCode: c.programCode });
  }

  // Badges (4-6) tied to competencies.
  const badgeSpecs = [
    { name: 'Analista de Negocios Jr.', comp: 0 },
    { name: 'Desarrollador OOP', comp: 1 },
    { name: 'Especialista en Datos', comp: 3 },
    { name: 'Asistente Clínico', comp: 4 },
    { name: 'Diseñador Instruccional', comp: 5 }
  ];
  for (const b of badgeSpecs) {
    await q(
      `INSERT INTO badges (name, description, criteria, competency_id)
       VALUES ($1,$2,$3,$4)`,
      [
        b.name,
        `Insignia ${b.name}.`,
        'Dominar la competencia asociada y aprobar la evaluación final.',
        compIds[b.comp].id
      ]
    );
  }

  // Student competency progress (mix of statuses).
  const statuses = ['not_started', 'in_progress', 'mastered'] as const;
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    // each student gets progress on 2 competencies
    for (let k = 0; k < 2; k++) {
      const comp = compIds[(i + k) % compIds.length];
      const status = statuses[(i + k) % statuses.length];
      await q(
        `INSERT INTO student_competency_progress (student_user_id, competency_id, status, evidence, achieved_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (student_user_id, competency_id) DO NOTHING`,
        [
          s.id,
          comp.id,
          status,
          status === 'mastered' ? 'Evidencia de dominio adjunta.' : null,
          status === 'mastered' ? new Date('2026-03-15').toISOString() : null
        ]
      );
    }
  }

  // Certificates (5-8) issued to students.
  function serialPart(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  const certKinds = ['course', 'program', 'badge'] as const;
  const issuedDates = ['2025-12-20', '2026-01-15', '2026-02-10', '2026-03-05', '2026-03-22', '2026-04-12'];
  for (let i = 0; i < 7; i++) {
    const s = students[i % students.length];
    const kind = certKinds[i % certKinds.length];
    const prog = pick(programs, i);
    const serial = `ATLAS-DEMO-${serialPart()}-${String(1000 + i)}`;
    const verification = `VC-DEMO-${randomUUID().slice(0, 12).toUpperCase()}`;
    const title =
      kind === 'program'
        ? `Certificado de finalización: ${prog.name}`
        : kind === 'badge'
          ? `Insignia verificada: ${prog.name}`
          : `Certificado de curso: módulo ${i + 1}`;
    await q(
      `INSERT INTO certificates
        (student_user_id, title, kind, moodle_course_id, degree_program_id, serial, verification_code, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        s.id,
        title,
        kind,
        kind === 'course' ? DEMO_COURSE_IDS[i % DEMO_COURSE_IDS.length] : null,
        kind !== 'course' ? prog.id : null,
        serial,
        verification,
        issuedDates[i % issuedDates.length]
      ]
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Syllabus + compliance
// ---------------------------------------------------------------------------
async function seedSyllabus(): Promise<void> {
  await q(
    `DELETE FROM syllabi WHERE term_id IN (SELECT id FROM academic_terms WHERE code LIKE 'DEMO-%')`
  );
  await q(`DELETE FROM ferpa_access_log WHERE actor_email = 'registrar@atlas.edu'`);

  // Reuse default template if present, else create one.
  let templateId: string | null = null;
  const tplRes = await q(`SELECT id FROM syllabus_templates WHERE is_active = true ORDER BY created_at LIMIT 1`);
  if (tplRes.rows.length > 0) {
    templateId = (tplRes.rows[0] as Row).id as string;
  } else {
    const ins = await q(
      `INSERT INTO syllabus_templates (name, sections, is_active)
       VALUES ($1, '[]'::jsonb, true) RETURNING id`,
      ['Plantilla institucional de Syllabus']
    );
    templateId = (ins.rows[0] as Row).id as string;
  }

  const activeTerm = terms[1];
  const syllabusSpecs = [
    { courseId: 3, programCode: 'DEMO-BBA-BA', title: 'Fundamentos de Administración', status: 'published' },
    { courseId: 4, programCode: 'DEMO-BS-CS', title: 'Introducción a la Programación', status: 'published' },
    { courseId: 5, programCode: 'DEMO-BS-CS', title: 'Estructuras de Datos', status: 'draft' },
    { courseId: 6, programCode: 'DEMO-CERT-DA', title: 'Analítica de Datos Aplicada', status: 'published' },
    { courseId: 7, programCode: 'DEMO-BS-NUR', title: 'Cuidados de Enfermería I', status: 'draft' }
  ];
  for (const s of syllabusSpecs) {
    await q(
      `INSERT INTO syllabi
        (moodle_course_id, degree_program_id, term_id, template_id, title, content, version, status, published_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,1,$7,$8)`,
      [
        s.courseId,
        programId(s.programCode),
        activeTerm.id,
        templateId,
        s.title,
        JSON.stringify({
          course_objectives: 'Los estudiantes dominarán los objetivos medibles del curso.',
          grading_policy: 'Evaluación ponderada: tareas 40%, examen parcial 25%, final 35%.',
          academic_integrity: 'Se aplica la política de integridad académica de Atlas Online University.'
        }),
        s.status,
        s.status === 'published' ? new Date('2026-01-10').toISOString() : null
      ]
    );
  }

  // Compliance records across all areas, varied statuses.
  const complianceSpecs: Array<{ area: string; title: string; status: string; detail: string; period: string }> = [
    { area: 'ferpa', title: 'Auditoría de acceso a expedientes (FERPA)', status: 'compliant', detail: 'Registros de acceso revisados.', period: '2026-Q1' },
    { area: 'ipeds', title: 'Reporte de inscripción IPEDS', status: 'pending', detail: 'Pendiente envío al NCES.', period: '2025-2026' },
    { area: 'wcag', title: 'Accesibilidad web WCAG 2.1 AA', status: 'action_required', detail: 'Contraste insuficiente en 3 páginas.', period: '2026-Q1' },
    { area: 'title_ix', title: 'Capacitación Title IX del personal', status: 'compliant', detail: 'Personal capacitado al 100%.', period: '2025-2026' },
    { area: 'ada', title: 'Acomodaciones ADA / Sección 504', status: 'compliant', detail: 'Solicitudes atendidas en plazo.', period: '2026-Q1' },
    { area: 'accreditation', title: 'Autoestudio de acreditación regional', status: 'pending', detail: 'En elaboración del informe.', period: '2025-2026' },
    { area: 'wcag', title: 'Subtítulos en contenido de video', status: 'action_required', detail: 'Faltan subtítulos en 8 videos.', period: '2026-Q1' },
    { area: 'ipeds', title: 'Reporte de finanzas IPEDS', status: 'compliant', detail: 'Enviado y aceptado.', period: '2024-2025' }
  ];
  // Idempotent re-seed: remove prior demo compliance rows by their exact titles
  // (kept clean/user-facing instead of a visible "[DEMO]" prefix).
  await q(`DELETE FROM compliance_records WHERE title = ANY($1)`, [complianceSpecs.map((c) => c.title)]);
  for (const c of complianceSpecs) {
    await q(
      `INSERT INTO compliance_records (area, title, status, detail, period)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.area, c.title, c.status, c.detail, c.period]
    );
  }

  // FERPA access log (4-5).
  const ferpaSpecs: Array<{ subject: SeedStudent; resource: string; action: string }> = [
    { subject: students[0], resource: 'expediente académico', action: 'view' },
    { subject: students[1], resource: 'historial de calificaciones', action: 'view' },
    { subject: students[2], resource: 'estado financiero', action: 'export' },
    { subject: students[3], resource: 'expediente académico', action: 'view' },
    { subject: students[4], resource: 'datos de contacto', action: 'update' }
  ];
  for (const f of ferpaSpecs) {
    await q(
      `INSERT INTO ferpa_access_log (actor_email, subject_user_id, resource, action)
       VALUES ($1,$2,$3,$4)`,
      ['registrar@atlas.edu', f.subject.id, f.resource, f.action]
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Back-office: staff directory, gl sync log
// ---------------------------------------------------------------------------
async function seedBackoffice(): Promise<void> {
  await q(`DELETE FROM staff_directory WHERE external_id LIKE 'demo-staff-%'`);
  await q(`DELETE FROM gl_sync_log WHERE external_id LIKE 'QB-DEMO-%'`);

  const staff: Array<{ name: string; email: string; role: string; type: string; country: string }> = [
    { name: 'Dr. Laura Mendoza', email: 'lmendoza@atlas.edu', role: 'Dean of Business', type: 'employee', country: 'CO' },
    { name: 'Dr. Andrés Ramírez', email: 'aramirez@atlas.edu', role: 'Dean of Technology', type: 'employee', country: 'CO' },
    { name: 'Carolina Vélez', email: 'cvelez@atlas.edu', role: 'Registrar', type: 'employee', country: 'CO' },
    { name: 'Jorge Mariño', email: 'jmarino@atlas.edu', role: 'Financial Aid Officer', type: 'employee', country: 'MX' },
    { name: 'Elena Suárez', email: 'esuarez@atlas.edu', role: 'Admissions Counselor', type: 'employee', country: 'CO' },
    { name: 'Pablo Restrepo', email: 'prestrepo@contractor.atlas.edu', role: 'Adjunct Instructor', type: 'contractor', country: 'AR' },
    { name: 'Mónica Lara', email: 'mlara@contractor.atlas.edu', role: 'Instructional Designer', type: 'contractor', country: 'PE' },
    { name: 'David Okafor', email: 'dokafor@atlas.edu', role: 'IT Support Lead', type: 'employee', country: 'US' }
  ];
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    await q(
      `INSERT INTO staff_directory
        (external_id, provider, full_name, email, role, employment_type, status, country, synced_at)
       VALUES ($1,'manual',$2,$3,$4,$5,'active',$6,now())`,
      [`demo-staff-${i + 1}`, s.name, s.email, s.role, s.type, s.country]
    );
  }

  // GL sync log (3-4).
  const glSpecs: Array<{ entity: string; status: string; message: string }> = [
    { entity: 'invoice', status: 'synced', message: 'Factura sincronizada a QuickBooks.' },
    { entity: 'payment', status: 'synced', message: 'Pago sincronizado a QuickBooks.' },
    { entity: 'invoice', status: 'pending', message: 'En cola de sincronización.' },
    { entity: 'payment', status: 'pending', message: 'Esperando confirmación de QuickBooks.' }
  ];
  for (const g of glSpecs) {
    await q(
      `INSERT INTO gl_sync_log (provider, entity_type, external_id, status, message)
       VALUES ('quickbooks',$1,$2,$3,$4)`,
      [g.entity, `QB-DEMO-${randomUUID().slice(0, 8)}`, g.status, g.message]
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Media / marketing: webinars + podcasts (only add academic demo content)
// ---------------------------------------------------------------------------
async function seedMedia(): Promise<void> {
  await q(`DELETE FROM webinars WHERE slug LIKE 'demo-%'`);
  await q(
    `DELETE FROM podcasts WHERE video_code IN ('UF8uR6Z6KLc','arj7oStGLkU','8jPQjjsBbIc','ZXsQAXx_ao0')`
  );

  // Each webinar gets a DISTINCT, verified-loading hero image and a real YouTube code.
  const webinars = [
    {
      slug: 'demo-webinar-ia-educacion',
      title: 'Inteligencia Artificial en la Educación Superior',
      subtitle: 'Conferencia magistral',
      description: 'Panel académico sobre el impacto de la IA en la enseñanza universitaria.',
      starts: '2026-03-10T18:00:00Z',
      hero: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1600&q=80',
      code: 'Hp7Id3Yb9XQ'
    },
    {
      slug: 'demo-webinar-investigacion',
      title: 'Métodos de Investigación Cuantitativa',
      subtitle: 'Seminario de posgrado',
      description: 'Taller práctico de diseño de investigación y análisis de datos.',
      starts: '2026-04-05T17:00:00Z',
      hero: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1600&q=80',
      code: 'iCvmsMzlF7o'
    },
    {
      slug: 'demo-webinar-admisiones',
      title: 'Casa Abierta Virtual: Admisiones 2026',
      subtitle: 'Sesión informativa',
      description: 'Conoce los programas y el proceso de admisión de Atlas Online University.',
      starts: '2026-02-20T22:00:00Z',
      hero: 'https://images.unsplash.com/photo-1543109740-4bdb38fda756?auto=format&fit=crop&w=1600&q=80',
      code: 'H14bBuluwB8'
    },
    {
      slug: 'demo-webinar-carreras',
      title: 'Tendencias del Mercado Laboral en Tecnología',
      subtitle: 'Charla de orientación profesional',
      description: 'Expertos comparten las habilidades más demandadas del sector tech.',
      starts: '2026-05-15T18:30:00Z',
      hero: 'https://images.unsplash.com/photo-1516534775068-ba3e7458af70?auto=format&fit=crop&w=1600&q=80',
      code: 'zLYECIjmnQs'
    }
  ];
  for (const w of webinars) {
    await q(
      `INSERT INTO webinars (id, slug, title, subtitle, description, hero_image, source_type, source_url, starts_at, is_active, show_on_landing)
       VALUES ($1,$2,$3,$4,$5,$6,'youtube',$7,$8,true,true)`,
      [randomUUID(), w.slug, w.title, w.subtitle, w.description, w.hero, `https://www.youtube.com/watch?v=${w.code}`, w.starts]
    );
  }

  // Real, distinct YouTube codes so each podcast shows a different working thumbnail.
  const podcasts = [
    { title: 'Liderazgo y Gestión Universitaria', code: 'UF8uR6Z6KLc', order: 10 },
    { title: 'Innovación en Pedagogía Digital', code: 'arj7oStGLkU', order: 11 },
    { title: 'Ciencia de Datos para Decisiones Académicas', code: '8jPQjjsBbIc', order: 12 },
    { title: 'Salud y Bienestar Estudiantil', code: 'ZXsQAXx_ao0', order: 13 }
  ];
  for (const p of podcasts) {
    await q(
      `INSERT INTO podcasts (id, title, video_code, video_url, published_at, is_active, show_on_landing, display_order)
       VALUES ($1,$2,$3,$4,'2026-02-01T00:00:00Z',true,true,$5)`,
      [randomUUID(), p.title, p.code, `https://www.youtube.com/watch?v=${p.code}`, p.order]
    );
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('Seeding Atlas Online University demo data...');
  // Use the real synced Moodle course ids so transcript/certs show course names.
  const courseRows = await pool.query<{ moodle_course_id: number }>(
    `SELECT moodle_course_id FROM moodle_courses ORDER BY moodle_course_id`
  );
  if (courseRows.rows.length > 0) {
    DEMO_COURSE_IDS = courseRows.rows.map((r) => Number(r.moodle_course_id));
    console.log(`  using ${DEMO_COURSE_IDS.length} real Moodle course ids`);
  }
  await seedAcademicStructure();
  console.log('  [1/8] academic structure ✓');
  await seedStudents();
  console.log('  [2/8] students ✓');
  await seedSis();
  console.log('  [3/8] SIS ✓');
  await seedCrm();
  console.log('  [4/8] CRM ✓');
  await seedCredentials();
  console.log('  [5/8] credentials ✓');
  await seedSyllabus();
  console.log('  [6/8] syllabus + compliance ✓');
  await seedBackoffice();
  console.log('  [7/8] back-office ✓');
  await seedMedia();
  console.log('  [8/8] media ✓');

  // Summary counts.
  const tables = [
    ['departments', `code LIKE 'DEMO-%'`],
    ['academic_terms', `code LIKE 'DEMO-%'`],
    ['degree_programs', `code LIKE 'DEMO-%'`],
    ['academic_calendar', `term_id IN (SELECT id FROM academic_terms WHERE code LIKE 'DEMO-%')`],
    ['users', `email LIKE '%${STUDENT_DOMAIN}'`],
    ['admissions_applications', `email LIKE '%${STUDENT_DOMAIN}'`],
    ['student_enrollments', `1=1`],
    ['student_ledger', `description IS NOT NULL`],
    ['invoices', `1=1`],
    ['payments', `1=1`],
    ['financial_aid', `1=1`],
    ['degree_requirements', `degree_program_id IN (SELECT id FROM degree_programs WHERE code LIKE 'DEMO-%')`],
    ['enrollment_holds', `1=1`],
    ['crm_contacts', `email LIKE '%@prospect.demo.atlas.edu'`],
    ['crm_activities', `1=1`],
    ['early_alerts', `signal IN ('login_gap_14d','grade_below_70','late_submission','financial_hold','no_activity_7d')`],
    ['competencies', `code LIKE 'DEMO-%'`],
    ['badges', `competency_id IN (SELECT id FROM competencies WHERE code LIKE 'DEMO-%')`],
    ['student_competency_progress', `1=1`],
    ['certificates', `serial LIKE 'ATLAS-DEMO-%'`],
    ['syllabi', `term_id IN (SELECT id FROM academic_terms WHERE code LIKE 'DEMO-%')`],
    ['compliance_records', `1=1`],
    ['ferpa_access_log', `actor_email = 'registrar@atlas.edu'`],
    ['staff_directory', `external_id LIKE 'demo-staff-%'`],
    ['gl_sync_log', `external_id LIKE 'QB-DEMO-%'`],
    ['webinars', `slug LIKE 'demo-%'`],
    ['podcasts', `video_code IN ('UF8uR6Z6KLc','arj7oStGLkU','8jPQjjsBbIc','ZXsQAXx_ao0')`]
  ] as const;

  console.log('\nSeeded counts:');
  for (const [table, where] of tables) {
    const r = await q(`SELECT COUNT(*)::int AS c FROM ${table} WHERE ${where}`);
    console.log(`  ${table.padEnd(30)} ${(r.rows[0] as { c: number }).c}`);
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await pool.end();
  process.exit(1);
});
