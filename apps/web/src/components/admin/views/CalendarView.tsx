import React, { useCallback, useEffect, useState } from 'react';

/**
 * Calendario académico y punto de control de aulas.
 *
 * El módulo ya generaba la malla de ocho semanas y comprobaba si un aula
 * estaba lista, pero sólo por API: quien lo necesita —coordinación académica—
 * no tiene terminal. Esta vista es ese acceso.
 *
 * Tres bloques, en el orden en que se usan:
 *
 *   1. Malla del término: generarla desde la fecha de inicio y verla.
 *   2. Festivos: la capa institucional. Al tocarla se regeneran TODAS las
 *      mallas, porque un festivo desplaza fechas en cada sección activa
 *      (Cláusula 7), y la vista lo dice al confirmarlo.
 *   3. Aulas listas: el checklist del jueves a las 10:00 ET (§8) y los avisos
 *      abiertos, con el estado real de entrega. Si no hay canal de correo
 *      configurado, el aviso se muestra como «registrado, sin enviar», que es
 *      lo que de verdad ocurrió.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type Holiday = { id: string; holiday_date: string; name_es: string; name_en: string; is_active: boolean };

type Deadline = { key: string; labelEs: string; labelEn: string; dueAt: string };

type TermWeek = {
  week: number;
  opensAt: string;
  startsOn: string;
  endsOn: string;
  shellReadyBy: string;
  deadlines: Deadline[];
  /** Festivos institucionales que caen dentro de la semana. */
  holidays: string[];
};

type Grid = { termId: string; revision: number; termStartsOn: string; termEndsOn: string; weeks: TermWeek[] };

type ShellItem = {
  moodleCourseId: number;
  courseName: string;
  week: number | null;
  shellReadyBy: string | null;
  ready: boolean;
  missing: string[];
  overdue: boolean;
};

type ShellCheck = {
  termId: string;
  checkedAt: string;
  total: number;
  ready: number;
  overdue: number;
  items: ShellItem[];
  alerts?: { open: number; delivered: Array<{ moodleCourseId: number; week: number; delivery: string; detail?: string }> };
};

type Alert = {
  id: string;
  term_id: string;
  moodle_course_id: number;
  course_name: string;
  week: number;
  severity: 'pending' | 'overdue';
  shell_ready_by: string | null;
  missing: string[];
  recipients: Array<{ role: string; name?: string; email: string }>;
  delivery: 'recorded' | 'sent' | 'failed';
  delivery_detail: string | null;
  created_at: string;
};

const DELIVERY_LABEL: Record<Alert['delivery'], string> = {
  sent: 'enviado',
  recorded: 'registrado, sin enviar',
  failed: 'fallo de envío'
};

async function call<T>(token: string, path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { message?: string; error?: string };
      detail = parsed.message ?? parsed.error ?? detail;
    } catch {
      if (raw) detail = raw;
    }
    throw new Error(detail);
  }
  return raw ? (JSON.parse(raw) as T) : (undefined as T);
}

/** Fecha y hora en el huso del aula, que es el que fija los plazos (§10). */
function easternLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York'
  });
}

export function CalendarView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (message: string | null) => void;
  setInfo: (message: string | null) => void;
}) {
  const [termId, setTermId] = useState('2026-FALL');
  const [startDate, setStartDate] = useState('');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [check, setCheck] = useState<ShellCheck | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [holidayForm, setHolidayForm] = useState({ date: '', nameEs: '', nameEn: '' });
  const [courseIds, setCourseIds] = useState('');

  const loadHolidays = useCallback(
    async (token: string) => {
      try {
        const result = await call<{ holidays: Holiday[] }>(token, '/admin/calendar/holidays');
        setHolidays(result.holidays ?? []);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los festivos');
      }
    },
    [setError]
  );

  const loadAlerts = useCallback(
    async (token: string) => {
      try {
        const result = await call<{ alerts: Alert[] }>(token, '/admin/calendar/alerts');
        setAlerts(result.alerts ?? []);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los avisos');
      }
    },
    [setError]
  );

  useEffect(() => {
    if (!sessionToken) return;
    void loadHolidays(sessionToken);
    void loadAlerts(sessionToken);
  }, [sessionToken, loadHolidays, loadAlerts]);

  const loadGrid = async () => {
    if (!sessionToken) return;
    setBusy('grid');
    setError(null);
    try {
      setGrid(await call<Grid>(sessionToken, `/v1/calendar/terms/${encodeURIComponent(termId)}`));
    } catch (reason) {
      setGrid(null);
      setError(reason instanceof Error ? reason.message : 'No hay malla para ese periodo');
    } finally {
      setBusy(null);
    }
  };

  const generateGrid = async () => {
    if (!sessionToken || !startDate) return;
    setBusy('grid');
    setError(null);
    try {
      const result = await call<Grid>(sessionToken, `/admin/calendar/terms/${encodeURIComponent(termId)}/grid`, {
        method: 'POST',
        body: { startDate }
      });
      setGrid(result);
      setInfo(`Malla de ${termId} generada (revisión ${result.revision}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo generar la malla');
    } finally {
      setBusy(null);
    }
  };

  const addHoliday = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionToken) return;
    setBusy('holiday');
    setError(null);
    try {
      const result = await call<{ regeneratedTerms: number }>(sessionToken, '/admin/calendar/holidays', {
        method: 'POST',
        body: holidayForm
      });
      setHolidayForm({ date: '', nameEs: '', nameEn: '' });
      await loadHolidays(sessionToken);
      setInfo(
        `Festivo añadido. Se regeneraron ${result.regeneratedTerms} malla(s): un festivo desplaza las fechas de todas las secciones activas.`
      );
      if (grid) void loadGrid();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo añadir el festivo');
    } finally {
      setBusy(null);
    }
  };

  const removeHoliday = async (id: string) => {
    if (!sessionToken) return;
    setBusy('holiday');
    try {
      const result = await call<{ regeneratedTerms: number }>(sessionToken, `/admin/calendar/holidays/${id}`, {
        method: 'DELETE'
      });
      await loadHolidays(sessionToken);
      setInfo(`Festivo desactivado. Se regeneraron ${result.regeneratedTerms} malla(s).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo desactivar el festivo');
    } finally {
      setBusy(null);
    }
  };

  const attachCourses = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionToken) return;
    const ids = courseIds
      .split(/[\s,]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (ids.length === 0) {
      setError('Indica al menos un ID de curso de Moodle.');
      return;
    }
    setBusy('attach');
    try {
      const result = await call<{ attached: number }>(
        sessionToken,
        `/admin/calendar/terms/${encodeURIComponent(termId)}/courses`,
        { method: 'POST', body: { moodleCourseIds: ids } }
      );
      setCourseIds('');
      setInfo(`${result.attached} curso(s) asociados a ${termId}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron asociar los cursos');
    } finally {
      setBusy(null);
    }
  };

  const runShellCheck = async () => {
    if (!sessionToken) return;
    setBusy('check');
    setError(null);
    try {
      const result = await call<ShellCheck>(
        sessionToken,
        `/admin/calendar/terms/${encodeURIComponent(termId)}/shell-check`
      );
      setCheck(result);
      await loadAlerts(sessionToken);
      setInfo(`${result.ready} de ${result.total} aulas listas · ${result.overdue} vencida(s).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo comprobar las aulas');
    } finally {
      setBusy(null);
    }
  };

  const pushToMoodle = async () => {
    if (!sessionToken) return;
    setBusy('push');
    try {
      const result = await call<{ ok: number; courses: number }>(
        sessionToken,
        `/admin/calendar/terms/${encodeURIComponent(termId)}/push-to-moodle`,
        { method: 'POST' }
      );
      setInfo(`Fechas propagadas a ${result.ok} de ${result.courses} curso(s).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron propagar las fechas');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid-1">
      <article className="card">
        <h2>Periodo académico</h2>
        <p className="muted">
          La malla son ocho semanas de martes a lunes. Los plazos los fija el Master Syllabus §10:
          respuesta inicial el martes, respuestas a compañeros el jueves y entrega el lunes, todos a
          las 23:59 ET. Un festivo mueve el plazo afectado al día siguiente, salvo cuando ya cae en
          el cierre del lunes.
        </p>
        <div className="login-form">
          <label htmlFor="cal-term">Identificador del periodo</label>
          <input id="cal-term" value={termId} onChange={(event) => setTermId(event.target.value)} placeholder="2026-FALL" />
          <label htmlFor="cal-start">Primer día de clase</label>
          <input
            id="cal-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <small className="muted">
            Si no cae en martes, la malla empieza el primer martes posterior.
          </small>
          <div className="inline-actions">
            <button onClick={() => void generateGrid()} disabled={busy !== null || !startDate}>
              {busy === 'grid' ? 'Generando…' : 'Generar malla'}
            </button>
            <button className="ghost" onClick={() => void loadGrid()} disabled={busy !== null}>
              Ver malla existente
            </button>
            <button className="ghost" onClick={() => void pushToMoodle()} disabled={busy !== null}>
              {busy === 'push' ? 'Propagando…' : 'Propagar fechas a Moodle'}
            </button>
          </div>
        </div>
      </article>

      {grid ? (
        <article className="card scroll-card">
          <h2>
            Malla de {grid.termId} · revisión {grid.revision}
          </h2>
          <table>
            <caption>
              Del {grid.termStartsOn} al {grid.termEndsOn}. Horas en huso del este (ET).
            </caption>
            <thead>
              <tr>
                <th scope="col">Semana</th>
                <th scope="col">Apertura</th>
                <th scope="col">Aula lista</th>
                <th scope="col">Plazos</th>
              </tr>
            </thead>
            <tbody>
              {grid.weeks.map((week) => (
                <tr key={week.week}>
                  <th scope="row">{week.week}</th>
                  <td>{easternLabel(week.opensAt)}</td>
                  <td>{easternLabel(week.shellReadyBy)}</td>
                  <td>
                    <ul className="calendar-deadlines">
                      {week.deadlines.map((deadline) => (
                        <li key={deadline.key}>
                          {deadline.labelEs}: {easternLabel(deadline.dueAt)}
                        </li>
                      ))}
                    </ul>
                    {week.holidays?.length ? (
                      // Se nombra el festivo porque es la explicación de que un
                      // plazo de esa semana no caiga donde se espera.
                      <em className="calendar-holiday">Festivo en la semana: {week.holidays.join(', ')}</em>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ) : null}

      <article className="card">
        <h2>Cursos del periodo</h2>
        <form className="login-form" onSubmit={attachCourses}>
          <label htmlFor="cal-courses">IDs de curso de Moodle</label>
          <input
            id="cal-courses"
            value={courseIds}
            onChange={(event) => setCourseIds(event.target.value)}
            placeholder="12, 13, 14"
          />
          <small className="muted">
            Son los cursos que el punto de control vigila para este periodo.
          </small>
          <button type="submit" disabled={busy !== null}>
            {busy === 'attach' ? 'Asociando…' : 'Asociar al periodo'}
          </button>
        </form>
      </article>

      <article className="card">
        <h2>Aulas listas</h2>
        <p className="muted">
          §8 del Master Syllabus: el aula de la semana entrante debe estar completa el jueves a las
          10:00 ET. El chequeo diario abre los avisos y cierra los que ya se resolvieron.
        </p>
        <button onClick={() => void runShellCheck()} disabled={busy !== null}>
          {busy === 'check' ? 'Comprobando…' : 'Comprobar ahora'}
        </button>
        {check ? (
          <table>
            <caption>
              Comprobado el {easternLabel(check.checkedAt)} · {check.ready} de {check.total} listas ·{' '}
              {check.overdue} vencida(s)
            </caption>
            <thead>
              <tr>
                <th scope="col">Curso</th>
                <th scope="col">Semana</th>
                <th scope="col">Corte</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {check.items.length === 0 ? (
                <tr>
                  <td colSpan={4}>No hay cursos asociados a este periodo.</td>
                </tr>
              ) : (
                check.items.map((item) => (
                  <tr key={item.moodleCourseId}>
                    <th scope="row">{item.courseName}</th>
                    <td>{item.week ?? '—'}</td>
                    <td>{easternLabel(item.shellReadyBy)}</td>
                    <td>
                      {item.ready ? (
                        <span className="badge">lista</span>
                      ) : (
                        <>
                          <span className={item.overdue ? 'badge danger' : 'badge'}>
                            {item.overdue ? 'vencida' : 'pendiente'}
                          </span>
                          <ul className="calendar-missing">
                            {item.missing.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}
      </article>

      <article className="card scroll-card">
        <h2>Avisos abiertos ({alerts.length})</h2>
        <table>
          <caption>
            Un aviso por curso y semana. Se cierra solo cuando el aula se completa.
          </caption>
          <thead>
            <tr>
              <th scope="col">Curso</th>
              <th scope="col">Semana</th>
              <th scope="col">Gravedad</th>
              <th scope="col">Avisados</th>
              <th scope="col">Entrega</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={5}>Sin avisos abiertos.</td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id}>
                  <th scope="row">{alert.course_name}</th>
                  <td>{alert.week}</td>
                  <td>
                    <span className={alert.severity === 'overdue' ? 'badge danger' : 'badge'}>
                      {alert.severity === 'overdue' ? 'vencida' : 'pendiente'}
                    </span>
                  </td>
                  <td>
                    {alert.recipients.length === 0 ? (
                      <em>sin destinatario resoluble</em>
                    ) : (
                      <ul className="calendar-missing">
                        {alert.recipients.map((recipient) => (
                          <li key={recipient.email}>
                            {recipient.role === 'instructor' ? 'Instructor' : 'Dirección de programa'}:{' '}
                            {recipient.name ? `${recipient.name} · ` : ''}
                            {recipient.email}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {DELIVERY_LABEL[alert.delivery]}
                    {alert.delivery_detail ? <div className="muted">{alert.delivery_detail}</div> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>

      <article className="card scroll-card">
        <h2>Festivos institucionales ({holidays.filter((h) => h.is_active).length} activos)</h2>
        <form className="login-form" onSubmit={addHoliday}>
          <label htmlFor="hol-date">Fecha</label>
          <input
            id="hol-date"
            type="date"
            value={holidayForm.date}
            onChange={(event) => setHolidayForm((current) => ({ ...current, date: event.target.value }))}
            required
          />
          <label htmlFor="hol-es">Nombre en español</label>
          <input
            id="hol-es"
            value={holidayForm.nameEs}
            onChange={(event) => setHolidayForm((current) => ({ ...current, nameEs: event.target.value }))}
            required
          />
          <label htmlFor="hol-en">Nombre en inglés</label>
          <input
            id="hol-en"
            value={holidayForm.nameEn}
            onChange={(event) => setHolidayForm((current) => ({ ...current, nameEn: event.target.value }))}
            required
          />
          <button type="submit" disabled={busy !== null}>
            {busy === 'holiday' ? 'Guardando…' : 'Añadir festivo'}
          </button>
        </form>
        <table>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Nombre</th>
              <th scope="col">Estado</th>
              <th scope="col">Acción</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((holiday) => (
              <tr key={holiday.id}>
                <th scope="row">{String(holiday.holiday_date).slice(0, 10)}</th>
                <td>
                  {holiday.name_es} / {holiday.name_en}
                </td>
                <td>{holiday.is_active ? 'activo' : 'desactivado'}</td>
                <td>
                  {holiday.is_active ? (
                    <button className="ghost danger" onClick={() => void removeHoliday(holiday.id)}>
                      Desactivar
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}
