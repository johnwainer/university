import type { Pool } from 'pg';

/**
 * Etapa I — Cálculo del checklist de estado documental (semáforo).
 *
 * Vive aparte de `routes.ts` por la misma razón que `modules/sis/service.ts`:
 * es lógica de dominio con reglas que conviene poder leer sin el ruido del
 * transporte HTTP.
 *
 * Regla contractual: esto es estado binario —qué evidencia existe y cuál
 * falta—, resuelto con consultas de existencia. No hay series históricas ni
 * indicadores: eso corresponde a la Etapa V.
 */

export type DocumentScope = 'institutional' | 'program' | 'faculty';
export type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
export type ChecklistSignal = 'green' | 'amber' | 'red';

export type ChecklistGap = {
  scope: DocumentScope;
  targetId: string | null;
  targetLabel: string;
  /** `missing` si no existe documento; si existe, su estado real o `expired`. */
  state: 'missing' | DocumentStatus | 'expired';
};

export type ChecklistItem = {
  documentTypeId: string;
  documentTypeCode: string;
  nameEs: string;
  nameEn: string;
  helpEs: string | null;
  helpEn: string | null;
  scope: DocumentScope;
  cieRequired: boolean;
  displayOrder: number;
  /** Unidades que deben tener evidencia: 1 institucional, N programas, N docentes. */
  expected: number;
  approved: number;
  pending: number;
  expired: number;
  missing: number;
  signal: ChecklistSignal;
  gaps: ChecklistGap[];
};

export type ChecklistSection = {
  scope: DocumentScope;
  titleEs: string;
  titleEn: string;
  items: ChecklistItem[];
  signal: ChecklistSignal;
};

export type CieChecklistResponse = {
  generatedAt: string;
  summary: {
    totalRequired: number;
    totalApproved: number;
    totalPending: number;
    totalExpired: number;
    totalMissing: number;
    completionPercent: number;
    signal: ChecklistSignal;
    cieReady: boolean;
  };
  sections: ChecklistSection[];
  counters: {
    programs: number;
    activePrograms: number;
    facultyRecords: number;
    activeFacultyRecords: number;
    documents: number;
    approvedDocuments: number;
    expiringSoon: number;
  };
};

const SCOPE_TITLES: Record<DocumentScope, { es: string; en: string }> = {
  institutional: { es: 'Evidencia institucional', en: 'Institutional evidence' },
  program: { es: 'Evidencia por programa', en: 'Evidence per program' },
  faculty: { es: 'Expedientes de faculty', en: 'Faculty records' }
};

/** Etiqueta de la unidad institucional en los gaps del checklist. */
const INSTITUTION_KEY = '__institution__';

type Counts = {
  expected: number;
  approved: number;
  pending: number;
  expired: number;
  missing: number;
};

/**
 * Traduce los conteos de una unidad de checklist a un color de semáforo.
 *
 * @param cieRequired `true` cuando la CIE exige el tipo. Decide cómo se lee
 *   un conjunto vacío, que es el caso que importa: ver abajo.
 */
export function signalFor(counts: Counts, cieRequired = true): ChecklistSignal {
  // Conjunto vacío: no hay programas ni expedientes activos sobre los cuales
  // exigir evidencia. NO es "completo". Un tablero de CIE readiness que pinta
  // en verde "0 de 0 aprobados" le dice a la institución que su evidencia de
  // faculty está lista cuando en realidad no hay ni un expediente cargado.
  // Si la CIE lo exige, eso es un hueco (rojo); si no lo exige, no hay nada
  // que probar y queda en verde.
  if (counts.expected === 0) {
    return cieRequired ? 'red' : 'green';
  }
  if (counts.approved === counts.expected) {
    return 'green';
  }
  if (counts.approved === 0 && counts.pending === 0 && counts.expired === 0) {
    return 'red';
  }
  return 'amber';
}

function worstSignal(signals: ChecklistSignal[]): ChecklistSignal {
  if (signals.includes('red')) {
    return 'red';
  }
  if (signals.includes('amber')) {
    return 'amber';
  }
  return 'green';
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Resuelve el checklist en una sola pasada por tipo de documento: se cruzan
 * las unidades esperadas (la institución, los programas activos, los
 * expedientes activos) contra los documentos existentes y se clasifica cada
 * unidad en aprobada / pendiente / vencida / faltante.
 *
 * Una pieza de evidencia solo cuenta como completa si está `approved` **y**
 * vigente: un documento aprobado cuya vigencia expiró dejó de probar nada
 * ante la CIE.
 */
export async function getCieChecklist(
  pool: Pool,
  institutionName: string
): Promise<CieChecklistResponse> {
  const [typesResult, programsResult, facultyResult, documentsResult, countersResult] =
    await Promise.all([
      pool.query(
        `SELECT id, code, name_es, name_en, scope, cie_required, display_order, help_es, help_en
         FROM cie_document_types
         WHERE is_active IS TRUE
         ORDER BY display_order, code`
      ),
      // `is_active` es el booleano de esta rama; no hay enum de estado.
      pool.query(
        `SELECT id, code, name FROM degree_programs WHERE is_active = true ORDER BY code`
      ),
      pool.query(
        `SELECT id, full_name FROM faculty_records WHERE status = 'active' ORDER BY full_name`
      ),
      pool.query(
        `SELECT document_type_id, program_id, faculty_id, status,
                (expires_at IS NOT NULL AND expires_at < CURRENT_DATE) AS is_expired
         FROM cie_documents`
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM degree_programs) AS programs,
           (SELECT COUNT(*)::int FROM degree_programs WHERE is_active = true) AS active_programs,
           (SELECT COUNT(*)::int FROM faculty_records) AS faculty_records,
           (SELECT COUNT(*)::int FROM faculty_records WHERE status = 'active') AS active_faculty_records,
           (SELECT COUNT(*)::int FROM cie_documents) AS documents,
           (SELECT COUNT(*)::int FROM cie_documents
             WHERE status = 'approved' AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)) AS approved_documents,
           (SELECT COUNT(*)::int FROM cie_documents
             WHERE expires_at IS NOT NULL
               AND expires_at >= CURRENT_DATE
               AND expires_at < CURRENT_DATE + INTERVAL '30 days') AS expiring_soon`
      )
    ]);

  const programs = programsResult.rows.map((row) => ({
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name)
  }));
  const faculty = facultyResult.rows.map((row) => ({
    id: asString(row.id),
    fullName: asString(row.full_name)
  }));

  /** Índice `${typeId}::${unitKey}` -> estado efectivo de la evidencia. */
  const documentIndex = new Map<string, { status: DocumentStatus; isExpired: boolean }>();
  for (const row of documentsResult.rows) {
    const typeId = asString(row.document_type_id);
    const unit =
      asNullableString(row.program_id) ?? asNullableString(row.faculty_id) ?? INSTITUTION_KEY;
    documentIndex.set(`${typeId}::${unit}`, {
      status: asString(row.status) as DocumentStatus,
      isExpired: Boolean(row.is_expired)
    });
  }

  const itemsByScope = new Map<DocumentScope, ChecklistItem[]>([
    ['institutional', []],
    ['program', []],
    ['faculty', []]
  ]);

  let totalRequired = 0;
  let totalApproved = 0;
  let totalPending = 0;
  let totalExpired = 0;
  let totalMissing = 0;

  for (const typeRow of typesResult.rows) {
    const scope = asString(typeRow.scope) as DocumentScope;
    const typeId = asString(typeRow.id);
    const cieRequired = Boolean(typeRow.cie_required);

    const units: Array<{ id: string | null; label: string; key: string }> =
      scope === 'institutional'
        ? [{ id: null, label: institutionName, key: INSTITUTION_KEY }]
        : scope === 'program'
          ? programs.map((program) => ({
              id: program.id,
              label: `${program.code} — ${program.name}`,
              key: program.id
            }))
          : faculty.map((member) => ({ id: member.id, label: member.fullName, key: member.id }));

    let approved = 0;
    let pending = 0;
    let expired = 0;
    let missing = 0;
    const gaps: ChecklistGap[] = [];

    for (const unit of units) {
      const found = documentIndex.get(`${typeId}::${unit.key}`);
      if (!found) {
        missing += 1;
        gaps.push({ scope, targetId: unit.id, targetLabel: unit.label, state: 'missing' });
        continue;
      }
      if (found.status === 'approved' && !found.isExpired) {
        approved += 1;
        continue;
      }
      if (found.status === 'approved' && found.isExpired) {
        expired += 1;
        gaps.push({ scope, targetId: unit.id, targetLabel: unit.label, state: 'expired' });
        continue;
      }
      pending += 1;
      gaps.push({ scope, targetId: unit.id, targetLabel: unit.label, state: found.status });
    }

    // Sin unidades configuradas el hueco real es ese: no hay nada registrado.
    // Se expone como gap para que la vista lo diga con palabras y no solo con
    // un contador "0/0" que se lee como trabajo terminado.
    if (units.length === 0 && cieRequired) {
      gaps.push({
        scope,
        targetId: null,
        targetLabel:
          scope === 'program'
            ? 'No hay programas activos registrados'
            : scope === 'faculty'
              ? 'No hay expedientes de faculty activos registrados'
              : 'Sin unidades registradas',
        state: 'missing'
      });
    }

    const counts: Counts = { expected: units.length, approved, pending, expired, missing };
    const item: ChecklistItem = {
      documentTypeId: typeId,
      documentTypeCode: asString(typeRow.code),
      nameEs: asString(typeRow.name_es),
      nameEn: asString(typeRow.name_en),
      helpEs: asNullableString(typeRow.help_es),
      helpEn: asNullableString(typeRow.help_en),
      scope,
      cieRequired,
      displayOrder: Number(typeRow.display_order ?? 0),
      ...counts,
      signal: signalFor(counts, cieRequired),
      gaps
    };

    itemsByScope.get(scope)?.push(item);

    // El resumen y el semáforo global miden solo lo que la CIE exige.
    if (cieRequired) {
      totalRequired += counts.expected;
      totalApproved += approved;
      totalPending += pending;
      totalExpired += expired;
      totalMissing += missing;
    }
  }

  const sections: ChecklistSection[] = (
    ['institutional', 'program', 'faculty'] as DocumentScope[]
  ).map((scope) => {
    const items = itemsByScope.get(scope) ?? [];
    return {
      scope,
      titleEs: SCOPE_TITLES[scope].es,
      titleEn: SCOPE_TITLES[scope].en,
      items,
      signal: worstSignal(items.filter((item) => item.cieRequired).map((item) => item.signal))
    };
  });

  const counters = countersResult.rows[0] ?? {};
  const completionPercent =
    totalRequired === 0 ? 0 : Math.round((totalApproved / totalRequired) * 100);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRequired,
      totalApproved,
      totalPending,
      totalExpired,
      totalMissing,
      completionPercent,
      signal: signalFor(
        {
          expected: totalRequired,
          approved: totalApproved,
          pending: totalPending,
          expired: totalExpired,
          missing: totalMissing
        },
        true
      ),
      cieReady: totalRequired > 0 && totalApproved === totalRequired
    },
    sections,
    counters: {
      programs: Number(counters.programs ?? 0),
      activePrograms: Number(counters.active_programs ?? 0),
      facultyRecords: Number(counters.faculty_records ?? 0),
      activeFacultyRecords: Number(counters.active_faculty_records ?? 0),
      documents: Number(counters.documents ?? 0),
      approvedDocuments: Number(counters.approved_documents ?? 0),
      expiringSoon: Number(counters.expiring_soon ?? 0)
    }
  };
}
