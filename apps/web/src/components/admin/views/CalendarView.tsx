import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

/**
 * El estado de entrega se guarda en CLAVES, no en texto: el rótulo se resuelve
 * al pintar, porque el panel lo leen personas que sólo hablan inglés y
 * personas que sólo hablan español.
 */
const DELIVERY_LABEL: Record<Alert['delivery'], string> = {
  sent: 'admin.calendar.entrega.enviado',
  recorded: 'admin.calendar.entrega.registrado',
  failed: 'admin.calendar.entrega.fallo'
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
  const { t } = useTranslation();
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
        setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.cargarFestivos'));
      }
    },
    [setError, t]
  );

  const loadAlerts = useCallback(
    async (token: string) => {
      try {
        const result = await call<{ alerts: Alert[] }>(token, '/admin/calendar/alerts');
        setAlerts(result.alerts ?? []);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.cargarAvisos'));
      }
    },
    [setError, t]
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
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.sinMalla'));
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
      setInfo(t('admin.calendar.info.mallaGenerada', { periodo: termId, revision: result.revision }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.generarMalla'));
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
      setInfo(t('admin.calendar.info.festivoAnadido', { count: result.regeneratedTerms }));
      if (grid) void loadGrid();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.anadirFestivo'));
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
      setInfo(t('admin.calendar.info.festivoDesactivado', { count: result.regeneratedTerms }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.desactivarFestivo'));
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
      setError(t('admin.calendar.errores.sinIds'));
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
      setInfo(t('admin.calendar.info.cursosAsociados', { count: result.attached, periodo: termId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.asociarCursos'));
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
      setInfo(
        t('admin.calendar.info.comprobacion', {
          listas: result.ready,
          total: result.total,
          count: result.overdue
        })
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.comprobarAulas'));
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
      setInfo(t('admin.calendar.info.fechasPropagadas', { ok: result.ok, count: result.courses }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.calendar.errores.propagarFechas'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid-1">
      <article className="card">
        <h2>{t('admin.calendar.periodo.titulo')}</h2>
        <p className="muted">{t('admin.calendar.periodo.descripcion')}</p>
        <div className="login-form">
          <label htmlFor="cal-term">{t('admin.calendar.periodo.campoId')}</label>
          <input id="cal-term" value={termId} onChange={(event) => setTermId(event.target.value)} placeholder="2026-FALL" />
          <label htmlFor="cal-start">{t('admin.calendar.periodo.campoInicio')}</label>
          <input
            id="cal-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <small className="muted">{t('admin.calendar.periodo.notaMartes')}</small>
          <div className="inline-actions">
            <button onClick={() => void generateGrid()} disabled={busy !== null || !startDate}>
              {busy === 'grid'
                ? t('admin.calendar.periodo.generando')
                : t('admin.calendar.periodo.generar')}
            </button>
            <button className="ghost" onClick={() => void loadGrid()} disabled={busy !== null}>
              {t('admin.calendar.periodo.verExistente')}
            </button>
            <button className="ghost" onClick={() => void pushToMoodle()} disabled={busy !== null}>
              {busy === 'push'
                ? t('admin.calendar.periodo.propagando')
                : t('admin.calendar.periodo.propagar')}
            </button>
          </div>
        </div>
      </article>

      {grid ? (
        <article className="card scroll-card">
          <h2>{t('admin.calendar.malla.titulo', { periodo: grid.termId, revision: grid.revision })}</h2>
          <table>
            <caption>
              {t('admin.calendar.malla.pie', { inicio: grid.termStartsOn, fin: grid.termEndsOn })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.calendar.malla.colSemana')}</th>
                <th scope="col">{t('admin.calendar.malla.colApertura')}</th>
                <th scope="col">{t('admin.calendar.malla.colAulaLista')}</th>
                <th scope="col">{t('admin.calendar.malla.colPlazos')}</th>
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
                      <em className="calendar-holiday">
                        {t('admin.calendar.malla.festivoEnSemana', { festivos: week.holidays.join(', ') })}
                      </em>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ) : null}

      <article className="card">
        <h2>{t('admin.calendar.cursos.titulo')}</h2>
        <form className="login-form" onSubmit={attachCourses}>
          <label htmlFor="cal-courses">{t('admin.calendar.cursos.campoIds')}</label>
          <input
            id="cal-courses"
            value={courseIds}
            onChange={(event) => setCourseIds(event.target.value)}
            placeholder="12, 13, 14"
          />
          <small className="muted">{t('admin.calendar.cursos.nota')}</small>
          <button type="submit" disabled={busy !== null}>
            {busy === 'attach' ? t('admin.calendar.cursos.asociando') : t('admin.calendar.cursos.asociar')}
          </button>
        </form>
      </article>

      <article className="card">
        <h2>{t('admin.calendar.aulas.titulo')}</h2>
        <p className="muted">{t('admin.calendar.aulas.descripcion')}</p>
        <button onClick={() => void runShellCheck()} disabled={busy !== null}>
          {busy === 'check' ? t('admin.calendar.aulas.comprobando') : t('admin.calendar.aulas.comprobar')}
        </button>
        {check ? (
          <table>
            <caption>
              {t('admin.calendar.aulas.pie', {
                fecha: easternLabel(check.checkedAt),
                listas: check.ready,
                total: check.total,
                count: check.overdue
              })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.calendar.aulas.colCurso')}</th>
                <th scope="col">{t('admin.calendar.aulas.colSemana')}</th>
                <th scope="col">{t('admin.calendar.aulas.colCorte')}</th>
                <th scope="col">{t('admin.calendar.aulas.colEstado')}</th>
              </tr>
            </thead>
            <tbody>
              {check.items.length === 0 ? (
                <tr>
                  <td colSpan={4}>{t('admin.calendar.aulas.vacio')}</td>
                </tr>
              ) : (
                check.items.map((item) => (
                  <tr key={item.moodleCourseId}>
                    <th scope="row">{item.courseName}</th>
                    <td>{item.week ?? '—'}</td>
                    <td>{easternLabel(item.shellReadyBy)}</td>
                    <td>
                      {item.ready ? (
                        <span className="badge">{t('admin.calendar.estado.lista')}</span>
                      ) : (
                        <>
                          <span className={item.overdue ? 'badge danger' : 'badge'}>
                            {item.overdue
                              ? t('admin.calendar.estado.vencida')
                              : t('admin.calendar.estado.pendiente')}
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
        <h2>{t('admin.calendar.avisos.titulo', { total: alerts.length })}</h2>
        <table>
          <caption>{t('admin.calendar.avisos.pie')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.calendar.avisos.colCurso')}</th>
              <th scope="col">{t('admin.calendar.avisos.colSemana')}</th>
              <th scope="col">{t('admin.calendar.avisos.colGravedad')}</th>
              <th scope="col">{t('admin.calendar.avisos.colAvisados')}</th>
              <th scope="col">{t('admin.calendar.avisos.colEntrega')}</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={5}>{t('admin.calendar.avisos.vacio')}</td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id}>
                  <th scope="row">{alert.course_name}</th>
                  <td>{alert.week}</td>
                  <td>
                    <span className={alert.severity === 'overdue' ? 'badge danger' : 'badge'}>
                      {alert.severity === 'overdue'
                        ? t('admin.calendar.estado.vencida')
                        : t('admin.calendar.estado.pendiente')}
                    </span>
                  </td>
                  <td>
                    {alert.recipients.length === 0 ? (
                      <em>{t('admin.calendar.avisos.sinDestinatario')}</em>
                    ) : (
                      <ul className="calendar-missing">
                        {alert.recipients.map((recipient) => (
                          <li key={recipient.email}>
                            {recipient.role === 'instructor'
                              ? t('admin.calendar.avisos.rolInstructor')
                              : t('admin.calendar.avisos.rolDireccion')}
                            :{' '}
                            {recipient.name ? `${recipient.name} · ` : ''}
                            {recipient.email}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {t(DELIVERY_LABEL[alert.delivery])}
                    {alert.delivery_detail ? <div className="muted">{alert.delivery_detail}</div> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>

      <article className="card scroll-card">
        <h2>
          {t('admin.calendar.festivos.titulo', { total: holidays.filter((h) => h.is_active).length })}
        </h2>
        <form className="login-form" onSubmit={addHoliday}>
          <label htmlFor="hol-date">{t('admin.calendar.festivos.campoFecha')}</label>
          <input
            id="hol-date"
            type="date"
            value={holidayForm.date}
            onChange={(event) => setHolidayForm((current) => ({ ...current, date: event.target.value }))}
            required
          />
          <label htmlFor="hol-es">{t('admin.calendar.festivos.campoNombreEs')}</label>
          <input
            id="hol-es"
            value={holidayForm.nameEs}
            onChange={(event) => setHolidayForm((current) => ({ ...current, nameEs: event.target.value }))}
            required
          />
          <label htmlFor="hol-en">{t('admin.calendar.festivos.campoNombreEn')}</label>
          <input
            id="hol-en"
            value={holidayForm.nameEn}
            onChange={(event) => setHolidayForm((current) => ({ ...current, nameEn: event.target.value }))}
            required
          />
          <button type="submit" disabled={busy !== null}>
            {busy === 'holiday'
              ? t('admin.calendar.festivos.guardando')
              : t('admin.calendar.festivos.anadir')}
          </button>
        </form>
        <table>
          <thead>
            <tr>
              <th scope="col">{t('admin.calendar.festivos.colFecha')}</th>
              <th scope="col">{t('admin.calendar.festivos.colNombre')}</th>
              <th scope="col">{t('admin.calendar.festivos.colEstado')}</th>
              <th scope="col">{t('admin.calendar.festivos.colAccion')}</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((holiday) => (
              <tr key={holiday.id}>
                <th scope="row">{String(holiday.holiday_date).slice(0, 10)}</th>
                <td>
                  {holiday.name_es} / {holiday.name_en}
                </td>
                <td>
                  {holiday.is_active
                    ? t('admin.calendar.festivos.activo')
                    : t('admin.calendar.festivos.desactivado')}
                </td>
                <td>
                  {holiday.is_active ? (
                    <button className="ghost danger" onClick={() => void removeHoliday(holiday.id)}>
                      {t('admin.calendar.festivos.desactivar')}
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
