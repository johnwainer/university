import type { Pool } from 'pg';

/**
 * Páginas institucionales del sitio público.
 *
 * La Etapa I del contrato exige "Home, About, Programs, Admissions, Contact y
 * políticas básicas". Home, Programs y Contact ya existían como vistas con
 * datos propios; el resto no existía en absoluto —y las rutas /v1/legal/terms
 * y /v1/legal/privacy que el front ya llamaba devolvían 404, así que los
 * enlaces de Términos y Privacidad abrían una página en blanco—.
 *
 * El contenido vive en base de datos y no en el código porque el entregable de
 * panel administrativo incluye la gestión de contenido: la institución tiene
 * que poder corregir su propio texto sin un despliegue. Bilingüe en columnas
 * separadas, igual que los eventos en vivo.
 */
export type SitePageRow = {
  slug: string;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  is_published: boolean;
  display_order: number;
  updated_at: string;
};

export async function migrateSitePages(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_pages (
      slug TEXT PRIMARY KEY,
      title_es TEXT NOT NULL,
      title_en TEXT NOT NULL,
      body_es TEXT NOT NULL,
      body_en TEXT NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS site_pages_published_idx ON site_pages(is_published, display_order);
  `);

  await seedSitePages(pool);
}

/**
 * Texto de arranque.
 *
 * Criterio deliberado sobre qué dice y qué NO dice: ninguna de estas páginas
 * afirma acreditación, licencia, antigüedad, tamaño ni composición del
 * claustro. La licencia de la CIE está prevista para noviembre de 2026 y a
 * esta fecha no existe, así que anunciarla sería falso; y el resto son datos
 * institucionales que sólo TFU puede confirmar. Lo que sí se afirma es
 * comprobable en la propia plataforma: la oferta, los idiomas y la modalidad.
 *
 * Las políticas (FERPA, Título IX, ADA) son los avisos estándar que exige una
 * institución estadounidense, redactados en su forma habitual y con los
 * contactos tomados de la configuración del entorno. Siguen necesitando
 * revisión y adopción formal por parte de TFU antes de la presentación ante la
 * CIE; están aquí para que existan y sean editables, no para sustituir esa
 * aprobación.
 *
 * Idempotente: sólo inserta la página que no exista. Una vez que TFU edite un
 * texto desde el panel, este seed no vuelve a tocarlo.
 */
async function seedSitePages(pool: Pool): Promise<void> {
  const existing = await pool.query<{ slug: string }>(`SELECT slug FROM site_pages`);
  const present = new Set(existing.rows.map((row) => row.slug));

  for (const page of SITE_PAGE_SEED) {
    if (present.has(page.slug)) {
      continue;
    }
    await pool.query(
      `INSERT INTO site_pages (slug, title_es, title_en, body_es, body_en, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO NOTHING`,
      [page.slug, page.titleEs, page.titleEn, page.bodyEs, page.bodyEn, page.order]
    );
  }
}

type SeedPage = {
  slug: string;
  order: number;
  titleEs: string;
  titleEn: string;
  bodyEs: string;
  bodyEn: string;
};

const contacto = {
  general: process.env.CONTACT_EMAIL ?? 'info@thefloridianuniversity.com',
  admisiones: process.env.ADMISSIONS_EMAIL ?? 'admissions@thefloridianuniversity.com',
  ferpa: process.env.FERPA_OFFICER_EMAIL ?? 'ferpa@thefloridianuniversity.com',
  titleIx: process.env.TITLE_IX_COORDINATOR_EMAIL ?? 'titleix@thefloridianuniversity.com',
  ada: process.env.ADA_COORDINATOR_EMAIL ?? 'accessibility@thefloridianuniversity.com'
};

export const SITE_PAGE_SEED: SeedPage[] = [
  {
    slug: 'about',
    order: 10,
    titleEs: 'Quiénes somos',
    titleEn: 'About us',
    bodyEs: `<p>The Floridian University es una institución de educación superior en línea que imparte programas profesionales en español e inglés. Toda la oferta se cursa en un aula virtual propia, con acompañamiento docente y una estructura semanal definida.</p>
<h3>Nuestro modelo</h3>
<p>Los programas se organizan en términos de ocho semanas, con una cadencia semanal fija: apertura de materiales, discusión con los compañeros y una entrega aplicada. La estructura es la misma en todos los cursos, de modo que un estudiante que cursa varios programas no tiene que aprender un formato nuevo cada vez.</p>
<h3>Áreas de formación</h3>
<p>La oferta actual se agrupa en cinco áreas: ventas y crecimiento de ingresos, experiencia del cliente, e-liderazgo y gestión de equipos remotos, inteligencia artificial como capacidad transversal, y transformación educativa. El catálogo público detalla cada programa, su duración y lo que se practica en él.</p>
<h3>Bilingüe de verdad</h3>
<p>Cada programa existe en español y en inglés, no como traducción automática sino como contenido equivalente en ambos idiomas. El estudiante elige su idioma y la plataforma entera —portal, aula y materiales— lo acompaña.</p>
<h3>Contacto</h3>
<p>Para información institucional: <a href="mailto:${contacto.general}">${contacto.general}</a>.</p>`,
    bodyEn: `<p>The Floridian University is an online higher-education institution delivering professional programs in Spanish and English. Every program runs in our own virtual classroom, with instructor support and a defined weekly structure.</p>
<h3>Our model</h3>
<p>Programs are organized in eight-week terms with a fixed weekly cadence: materials open, students discuss with peers, and an applied assignment is submitted. The structure is the same across every course, so a student taking more than one program never has to learn a new format.</p>
<h3>Areas of study</h3>
<p>The current offering is grouped into five areas: sales and revenue growth, customer experience, e-leadership and remote team management, AI as a cross-cutting capability, and education transformation. The public catalog details each program, its length and what is practiced in it.</p>
<h3>Genuinely bilingual</h3>
<p>Every program exists in Spanish and in English — not as machine translation but as equivalent content in both languages. Students pick their language and the whole platform, portal, classroom and materials, follows.</p>
<h3>Contact</h3>
<p>For institutional information: <a href="mailto:${contacto.general}">${contacto.general}</a>.</p>`
  },
  {
    slug: 'admissions',
    order: 20,
    titleEs: 'Admisiones',
    titleEn: 'Admissions',
    bodyEs: `<p>La admisión a los programas de The Floridian University se gestiona por convocatorias. Esta página describe el proceso y cómo iniciarlo.</p>
<h3>Cómo postular</h3>
<ol>
<li><strong>Solicita información.</strong> Escribe a <a href="mailto:${contacto.admisiones}">${contacto.admisiones}</a> o usa el formulario de contacto del sitio indicando el programa que te interesa.</li>
<li><strong>Conversación de orientación.</strong> El equipo de admisiones revisa contigo el programa, la dedicación semanal que exige y las fechas de la convocatoria vigente.</li>
<li><strong>Postulación formal.</strong> Se abre tu expediente y se te indica la documentación que debes aportar.</li>
<li><strong>Decisión y matrícula.</strong> Recibes la respuesta por escrito y, si es favorable, las instrucciones para matricularte y acceder al aula.</li>
</ol>
<h3>Qué necesitas</h3>
<p>Los requisitos concretos dependen del programa y del nivel. En todos los casos se requiere identificación vigente y el comprobante de estudios previos que corresponda al nivel del programa. El equipo de admisiones te confirma la lista exacta antes de que formalices la postulación.</p>
<h3>Dedicación</h3>
<p>Los programas van de 6 a 20 horas de trabajo total, distribuidas en términos de ocho semanas. La ficha de cada programa en el catálogo indica su duración.</p>
<h3>Preguntas</h3>
<p>Admisiones: <a href="mailto:${contacto.admisiones}">${contacto.admisiones}</a>.</p>`,
    bodyEn: `<p>Admission to The Floridian University programs is handled by intake. This page describes the process and how to start it.</p>
<h3>How to apply</h3>
<ol>
<li><strong>Request information.</strong> Write to <a href="mailto:${contacto.admisiones}">${contacto.admisiones}</a> or use the contact form, naming the program you are interested in.</li>
<li><strong>Advising conversation.</strong> The admissions team reviews the program with you, the weekly commitment it requires, and the dates of the current intake.</li>
<li><strong>Formal application.</strong> Your file is opened and you are told which documents to provide.</li>
<li><strong>Decision and enrollment.</strong> You receive a written response and, if favorable, instructions to enroll and reach the classroom.</li>
</ol>
<h3>What you need</h3>
<p>Specific requirements depend on the program and its level. In every case you will need valid identification and proof of prior study appropriate to the program level. Admissions confirms the exact list before you formalize your application.</p>
<h3>Commitment</h3>
<p>Programs range from 6 to 20 total hours of work, spread across eight-week terms. Each program page in the catalog states its length.</p>
<h3>Questions</h3>
<p>Admissions: <a href="mailto:${contacto.admisiones}">${contacto.admisiones}</a>.</p>`
  },
  {
    slug: 'terms',
    order: 30,
    titleEs: 'Términos y condiciones',
    titleEn: 'Terms and Conditions',
    bodyEs: `<p>Estos términos rigen el uso del portal y del aula virtual de The Floridian University.</p>
<h3>1. Cuenta y acceso</h3>
<p>El acceso es personal e intransferible. Eres responsable de la confidencialidad de tu contraseña y de toda actividad realizada desde tu cuenta. Avísanos de inmediato si detectas un uso no autorizado.</p>
<h3>2. Uso del contenido</h3>
<p>Los materiales de los programas son para tu estudio personal. No está permitido reproducirlos, redistribuirlos ni publicarlos fuera de la plataforma sin autorización escrita de la institución.</p>
<h3>3. Conducta académica</h3>
<p>Se espera trabajo propio. El plagio, la suplantación y la colaboración no autorizada son faltas académicas y pueden dar lugar a la pérdida de la calificación o de la matrícula.</p>
<h3>4. Disponibilidad</h3>
<p>La plataforma se ofrece de forma continua, salvo ventanas de mantenimiento, que se anuncian con antelación cuando son previsibles.</p>
<h3>5. Cambios</h3>
<p>Estos términos pueden actualizarse. La fecha de última actualización aparece al pie de la página y los cambios sustanciales se comunican a los estudiantes activos.</p>
<h3>6. Contacto</h3>
<p>Consultas sobre estos términos: <a href="mailto:${contacto.general}">${contacto.general}</a>.</p>`,
    bodyEn: `<p>These terms govern use of The Floridian University portal and virtual classroom.</p>
<h3>1. Account and access</h3>
<p>Access is personal and non-transferable. You are responsible for keeping your password confidential and for all activity carried out from your account. Tell us immediately if you detect unauthorized use.</p>
<h3>2. Use of content</h3>
<p>Program materials are for your personal study. Reproducing, redistributing or publishing them outside the platform is not permitted without written authorization from the institution.</p>
<h3>3. Academic conduct</h3>
<p>Your own work is expected. Plagiarism, impersonation and unauthorized collaboration are academic offenses and may result in loss of grade or enrollment.</p>
<h3>4. Availability</h3>
<p>The platform is offered continuously, except for maintenance windows, which are announced in advance when foreseeable.</p>
<h3>5. Changes</h3>
<p>These terms may be updated. The last-updated date appears at the foot of the page and substantive changes are communicated to active students.</p>
<h3>6. Contact</h3>
<p>Questions about these terms: <a href="mailto:${contacto.general}">${contacto.general}</a>.</p>`
  },
  {
    slug: 'privacy',
    order: 40,
    titleEs: 'Política de privacidad',
    titleEn: 'Privacy Policy',
    bodyEs: `<p>Esta política explica qué datos trata The Floridian University a través del portal y del aula virtual, y para qué.</p>
<h3>Qué recogemos</h3>
<p>Datos de identificación y contacto que tú facilitas (nombre, correo, idioma), datos académicos generados por tu actividad en el aula (progreso, entregas, calificaciones) y datos técnicos mínimos necesarios para operar el servicio.</p>
<h3>Para qué</h3>
<p>Para prestarte el servicio educativo, llevar tu expediente académico, comunicarnos contigo sobre tus programas y cumplir las obligaciones legales e institucionales aplicables.</p>
<h3>Con quién se comparten</h3>
<p>No vendemos tus datos ni los cedemos con fines comerciales. Se comparten únicamente con los proveedores tecnológicos que operan la plataforma, bajo contrato y sólo en la medida necesaria, y con las autoridades cuando la ley lo exija.</p>
<h3>Tus derechos</h3>
<p>Puedes solicitar acceso, corrección o eliminación de tus datos personales, con los límites que impone la conservación del expediente académico. Los derechos sobre el expediente educativo se rigen además por la normativa FERPA; consulta el Aviso FERPA.</p>
<h3>Conservación</h3>
<p>El expediente académico se conserva conforme a la normativa aplicable a instituciones de educación superior. El resto de los datos se conserva mientras exista relación con la institución.</p>
<h3>Contacto</h3>
<p>Solicitudes sobre datos personales: <a href="mailto:${contacto.ferpa}">${contacto.ferpa}</a>.</p>`,
    bodyEn: `<p>This policy explains what data The Floridian University processes through the portal and the virtual classroom, and why.</p>
<h3>What we collect</h3>
<p>Identification and contact data you provide (name, email, language), academic data generated by your classroom activity (progress, submissions, grades), and the minimum technical data needed to operate the service.</p>
<h3>Why</h3>
<p>To provide the educational service, maintain your academic record, communicate with you about your programs, and meet applicable legal and institutional obligations.</p>
<h3>Who it is shared with</h3>
<p>We do not sell your data or transfer it for commercial purposes. It is shared only with the technology providers that operate the platform, under contract and only to the extent necessary, and with authorities where the law requires it.</p>
<h3>Your rights</h3>
<p>You may request access to, correction of, or deletion of your personal data, within the limits imposed by retention of the academic record. Rights over the education record are additionally governed by FERPA; see the FERPA Notice.</p>
<h3>Retention</h3>
<p>The academic record is retained in accordance with the rules applicable to higher-education institutions. Other data is retained while a relationship with the institution exists.</p>
<h3>Contact</h3>
<p>Personal data requests: <a href="mailto:${contacto.ferpa}">${contacto.ferpa}</a>.</p>`
  },
  {
    slug: 'ferpa',
    order: 50,
    titleEs: 'Aviso FERPA',
    titleEn: 'FERPA Notice',
    bodyEs: `<p>La Family Educational Rights and Privacy Act (FERPA) otorga a los estudiantes determinados derechos sobre su expediente educativo. Este aviso resume esos derechos.</p>
<h3>Derecho de acceso</h3>
<p>Puedes inspeccionar y revisar tu expediente educativo dentro de los 45 días siguientes a tu solicitud. Dirígela por escrito al responsable FERPA, identificando qué parte del expediente quieres consultar.</p>
<h3>Derecho de rectificación</h3>
<p>Si consideras que tu expediente contiene información inexacta o engañosa, puedes pedir por escrito su corrección. Si la institución decide no corregirla, se te informará de tu derecho a una audiencia.</p>
<h3>Consentimiento para la divulgación</h3>
<p>La institución no divulga información personal identificable de tu expediente sin tu consentimiento escrito, salvo en los supuestos que FERPA permite expresamente —entre ellos, la divulgación a personal de la institución con interés educativo legítimo—.</p>
<h3>Información de directorio</h3>
<p>La institución puede designar como información de directorio determinados datos que no se consideran perjudiciales si se divulgan. Puedes solicitar por escrito que tu información de directorio no se divulgue.</p>
<h3>Derecho de reclamación</h3>
<p>Puedes presentar una reclamación ante la oficina competente del Departamento de Educación de los Estados Unidos si consideras que la institución no ha cumplido con FERPA.</p>
<h3>Responsable FERPA</h3>
<p><a href="mailto:${contacto.ferpa}">${contacto.ferpa}</a></p>`,
    bodyEn: `<p>The Family Educational Rights and Privacy Act (FERPA) affords students certain rights with respect to their education records. This notice summarizes those rights.</p>
<h3>Right to inspect and review</h3>
<p>You may inspect and review your education records within 45 days of the day the institution receives your request. Submit it in writing to the FERPA Officer, identifying the records you wish to inspect.</p>
<h3>Right to request amendment</h3>
<p>If you believe your record contains information that is inaccurate or misleading, you may ask in writing that it be amended. If the institution decides not to amend it, you will be notified of your right to a hearing.</p>
<h3>Consent to disclosure</h3>
<p>The institution does not disclose personally identifiable information from your education records without your written consent, except where FERPA expressly permits it — including disclosure to school officials with a legitimate educational interest.</p>
<h3>Directory information</h3>
<p>The institution may designate certain data as directory information, which is not considered harmful if disclosed. You may request in writing that your directory information be withheld.</p>
<h3>Right to file a complaint</h3>
<p>You may file a complaint with the office in the U.S. Department of Education that administers FERPA if you believe the institution has failed to comply with it.</p>
<h3>FERPA Officer</h3>
<p><a href="mailto:${contacto.ferpa}">${contacto.ferpa}</a></p>`
  },
  {
    slug: 'title-ix',
    order: 60,
    titleEs: 'Título IX y no discriminación',
    titleEn: 'Title IX and Non-Discrimination',
    bodyEs: `<p>The Floridian University prohíbe la discriminación por razón de sexo, incluido el acoso sexual y la violencia sexual, conforme al Título IX de las Enmiendas Educativas de 1972.</p>
<h3>Alcance</h3>
<p>Esta prohibición aplica a los programas y actividades de la institución y a toda la comunidad: estudiantes, personal docente, personal administrativo y quienes se relacionan con la institución.</p>
<h3>Cómo informar</h3>
<p>Cualquier persona puede informar de una conducta posiblemente contraria al Título IX, sea o no la persona afectada. Los informes pueden presentarse en cualquier momento, también de forma anónima, ante el coordinador de Título IX.</p>
<h3>Qué ocurre después</h3>
<p>El coordinador contacta a la persona afectada, le explica las medidas de apoyo disponibles y el procedimiento formal de queja, y respeta su decisión sobre cómo proceder, salvo cuando exista un riesgo que obligue a actuar.</p>
<h3>Prohibición de represalias</h3>
<p>Está prohibida cualquier represalia contra quien informe, participe o se niegue a participar en un procedimiento de Título IX.</p>
<h3>Coordinador de Título IX</h3>
<p><a href="mailto:${contacto.titleIx}">${contacto.titleIx}</a></p>`,
    bodyEn: `<p>The Floridian University prohibits discrimination on the basis of sex, including sexual harassment and sexual violence, in compliance with Title IX of the Education Amendments of 1972.</p>
<h3>Scope</h3>
<p>This prohibition applies to the institution's programs and activities and to the whole community: students, faculty, staff and those who deal with the institution.</p>
<h3>How to report</h3>
<p>Anyone may report conduct that may violate Title IX, whether or not they are the person affected. Reports may be made at any time, including anonymously, to the Title IX Coordinator.</p>
<h3>What happens next</h3>
<p>The Coordinator contacts the affected person, explains the supportive measures available and the formal complaint process, and respects their decision on how to proceed, except where a risk requires action.</p>
<h3>No retaliation</h3>
<p>Retaliation against anyone who reports, participates in, or declines to participate in a Title IX process is prohibited.</p>
<h3>Title IX Coordinator</h3>
<p><a href="mailto:${contacto.titleIx}">${contacto.titleIx}</a></p>`
  },
  {
    slug: 'accessibility',
    order: 70,
    titleEs: 'Accesibilidad',
    titleEn: 'Accessibility',
    bodyEs: `<p>The Floridian University trabaja para que su portal y su aula virtual sean utilizables por cualquier persona, conforme a la Americans with Disabilities Act (ADA) y a la Sección 504 de la Rehabilitation Act.</p>
<h3>Estándar aplicado</h3>
<p>El sitio público se desarrolla siguiendo las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1, nivel AA: contraste de texto suficiente, navegación completa por teclado con foco visible, nombres accesibles en todos los controles, idioma declarado y respeto por la preferencia de movimiento reducido del sistema.</p>
<h3>Qué estamos revisando</h3>
<p>La accesibilidad no es un estado final sino una revisión continua. Las áreas que seguimos evaluando son el aula virtual —cuyo contenido depende también de los materiales que suben los docentes— y los documentos descargables.</p>
<h3>Ajustes razonables</h3>
<p>Si necesitas un ajuste para acceder a un programa o a un material, escríbenos lo antes posible para poder organizarlo a tiempo.</p>
<h3>Informar de una barrera</h3>
<p>Si encuentras una parte del sitio que no puedes usar, cuéntanoslo indicando la página y qué ocurrió. Es la vía más rápida para corregirlo.</p>
<h3>Contacto de accesibilidad</h3>
<p><a href="mailto:${contacto.ada}">${contacto.ada}</a></p>`,
    bodyEn: `<p>The Floridian University works to make its portal and virtual classroom usable by anyone, in line with the Americans with Disabilities Act (ADA) and Section 504 of the Rehabilitation Act.</p>
<h3>Standard applied</h3>
<p>The public site is built following the Web Content Accessibility Guidelines (WCAG) 2.1, level AA: sufficient text contrast, full keyboard navigation with a visible focus indicator, accessible names on every control, a declared document language, and respect for the system's reduced-motion preference.</p>
<h3>What we are still reviewing</h3>
<p>Accessibility is not a finished state but an ongoing review. The areas we keep evaluating are the virtual classroom — whose content also depends on the materials instructors upload — and downloadable documents.</p>
<h3>Reasonable accommodations</h3>
<p>If you need an accommodation to access a program or a material, write to us as early as possible so it can be arranged in time.</p>
<h3>Reporting a barrier</h3>
<p>If you find part of the site you cannot use, tell us which page and what happened. That is the fastest route to fixing it.</p>
<h3>Accessibility contact</h3>
<p><a href="mailto:${contacto.ada}">${contacto.ada}</a></p>`
  }
];
