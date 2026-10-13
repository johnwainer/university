/**
 * «Mi programa»: la vista con la que se entra a la plataforma del estudiante.
 *
 * El portal tenía «Mis cursos», «Expediente» y «Perfil», pero no tenía
 * programa, y eso contradecía el modelo del proyecto: el programa es la unidad
 * en la que uno se matricula y los cursos viven dentro. El estudiante no tenía
 * dónde ver su plan de estudios, su periodo, sus plazos ni sus notas.
 *
 * Dos decisiones de esta pantalla que no son cosméticas:
 *
 * 1. **La matrícula en el programa y el acceso al aula se muestran por
 *    separado.** Son dos hechos distintos —uno de la plataforma, otro de
 *    Moodle— y hoy el segundo está pendiente de habilitarse. La fila del curso
 *    dice que el aula no está disponible todavía y deja ver todo lo demás, en
 *    vez de aparecer vacía o fingir un enlace que daría 403.
 * 2. **Una nota sin registrar dice «sin calificar», no un guion ni un cero.**
 *    Y la escala lleva su nota al pie: es la estándar de 4,0 y TFU no ha
 *    confirmado la suya, así que no se presenta como aprobada.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type CursoMatriculado,
  type MiProgramaResponse,
  type SemanaDelPeriodo
} from '../lib/api';

type Props = {
  token: string;
  /** Abre el aula del campus virtual. La da el contenedor, que es quien navega. */
  onAbrirAula: (moodleCourseId: number, titulo: string) => void;
  onGoAcademics?: () => void;
  onGoCatalog?: () => void;
};

function fecha(valor: string | null | undefined, locale: string): string {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * Zona horaria en la que están definidos los plazos del periodo.
 *
 * El Master Syllabus fija los cierres a las 23:59 hora del Este, y la malla ya
 * resuelve el cambio de horario de verano al generarlos. Si se pintaran en la
 * zona del navegador, el mismo plazo se leería distinto en cada equipo: a un
 * estudiante con el navegador en UTC le aparecía «14 oct, 03:59», que es el
 * mismo instante que las 23:59 del 13 pero no se parece en nada a la norma que
 * dice el sílabo. Se muestran siempre en hora del Este y con la zona escrita,
 * que es como está redactada la política.
 */
const ZONA_ACADEMICA = 'America/New_York';

function fechaHora(valor: string, locale: string): string {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA_ACADEMICA,
    timeZoneName: 'short'
  });
}

/**
 * La semana en curso dentro de la malla.
 *
 * Se compara contra `endsOn` y no contra `startsOn` porque la semana del
 * periodo corre de martes a lunes con cierre a las 23:59 ET: lo que determina
 * en qué semana estás es cuál es la primera que todavía no ha cerrado.
 */
function semanaEnCurso(semanas: SemanaDelPeriodo[]): SemanaDelPeriodo | null {
  const ahora = Date.now();
  const vigente = semanas.find((s) => new Date(s.closesAt).getTime() >= ahora);
  return vigente ?? null;
}

export function StudentProgram({ token, onAbrirAula, onGoAcademics, onGoCatalog }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en' : 'es';

  const [datos, setDatos] = useState<MiProgramaResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    api.publicAuth
      .program(token)
      .then((r) => {
        if (!cancelado) setDatos(r);
      })
      .catch((e) => {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const programa = datos?.programs?.[0] ?? null;

  const resumen = useMemo(() => {
    const cursos = programa?.courses ?? [];
    const aprobados = cursos.filter((c) => c.status === 'completed' && c.gradePoints !== null && c.gradePoints >= 1.7);
    const enCurso = cursos.filter((c) => c.status === 'enrolled');
    const conPuntos = cursos.filter((c) => c.gradePoints !== null);
    const creditosPonderados = conPuntos.reduce((acc, c) => acc + (c.gradePoints ?? 0) * c.creditHours, 0);
    const creditosConNota = conPuntos.reduce((acc, c) => acc + c.creditHours, 0);
    const creditosGanados = cursos
      .filter((c) => c.status === 'completed' && c.gradePoints !== null && c.gradePoints >= 1.7)
      .reduce((acc, c) => acc + c.creditHours, 0);
    return {
      total: cursos.length,
      aprobados: aprobados.length,
      enCurso: enCurso.length,
      // Se calcula aquí sólo para mostrarlo junto al programa; el promedio
      // oficial del expediente lo calcula el servidor en /v1/me/gpa.
      promedio: creditosConNota > 0 ? creditosPonderados / creditosConNota : null,
      creditosGanados
    };
  }, [programa]);

  const semanas = datos?.termGrid?.weeks ?? [];
  const semana = useMemo(() => semanaEnCurso(semanas), [semanas]);

  if (cargando) {
    return (
      <section className="section-block">
        <p>{t('myProgram.loading')}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="section-block">
        <h2>{t('myProgram.title')}</h2>
        <p className="profile-editor-feedback error">{error}</p>
      </section>
    );
  }

  if (!programa) {
    return (
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <h2>{t('myProgram.title')}</h2>
            <p className="row-subtitle">{t('myProgram.subtitle')}</p>
          </div>
        </div>
        <p>{t('myProgram.empty')}</p>
        <p className="row-subtitle">{t('myProgram.emptyHelp')}</p>
        {onGoCatalog ? (
          <button className="ghost-btn" onClick={onGoCatalog}>
            {t('myProgram.exploreCatalog')}
          </button>
        ) : null}
      </section>
    );
  }

  const nivel = programa.degreeLevel
    ? t(`myProgram.levels.${programa.degreeLevel}`, { defaultValue: programa.degreeLevel })
    : null;

  return (
    <section className="section-block mi-programa">
      <div className="section-header-row">
        <div>
          <h2>{t('myProgram.title')}</h2>
          <p className="row-subtitle">{t('myProgram.subtitle')}</p>
        </div>
        {onGoAcademics ? (
          <button className="ghost-btn" onClick={onGoAcademics}>
            {t('myProgram.goAcademics')}
          </button>
        ) : null}
      </div>

      <article className="mp-cabecera">
        <h3>{programa.programName ?? programa.programCode}</h3>
        <ul className="mp-meta">
          {nivel ? (
            <li>
              <span>{t('myProgram.level')}</span>
              <strong>{nivel}</strong>
            </li>
          ) : null}
          <li>
            <span>{t('myProgram.term')}</span>
            <strong>
              {programa.term.name}
              {programa.term.startsOn && programa.term.endsOn
                ? ` · ${t('myProgram.termDates', {
                    inicio: fecha(programa.term.startsOn, locale),
                    fin: fecha(programa.term.endsOn, locale)
                  })}`
                : null}
            </strong>
          </li>
          {!programa.term.isActive ? (
            <li>
              <strong className="mp-cerrado">{t('myProgram.termClosed')}</strong>
            </li>
          ) : null}
        </ul>
        {programa.programDescription ? <p className="mp-descripcion">{programa.programDescription}</p> : null}
      </article>

      <div className="profile-summary-grid">
        <article className="profile-summary-card">
          <span>{t('myProgram.summary.courses')}</span>
          <strong>{resumen.total}</strong>
        </article>
        <article className="profile-summary-card">
          <span>{t('myProgram.summary.inProgress')}</span>
          <strong>{resumen.enCurso}</strong>
        </article>
        <article className="profile-summary-card">
          <span>{t('myProgram.summary.completed')}</span>
          <strong>{resumen.aprobados}</strong>
        </article>
        <article className="profile-summary-card">
          <span>{t('myProgram.summary.gpa')}</span>
          <strong>
            {resumen.promedio === null ? (
              <span className="mp-sin-dato">{t('myProgram.summary.gpaPending')}</span>
            ) : (
              resumen.promedio.toFixed(2)
            )}
          </strong>
        </article>
      </div>

      <section className="mp-plan">
        <div className="section-header-row">
          <div>
            <h3>{t('myProgram.plan.title')}</h3>
            <p className="row-subtitle">{t('myProgram.plan.subtitle')}</p>
          </div>
        </div>
        <div className="mp-tabla-wrap">
          <table className="mp-tabla">
            <thead>
              <tr>
                <th>{t('myProgram.plan.course')}</th>
                <th>{t('myProgram.plan.status')}</th>
                <th>{t('myProgram.plan.grade')}</th>
                <th>{t('myProgram.plan.progress')}</th>
                <th>{t('myProgram.plan.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {programa.courses.map((curso) => (
                <FilaCurso key={curso.enrollmentId} curso={curso} onAbrirAula={onAbrirAula} />
              ))}
            </tbody>
          </table>
        </div>
        {datos?.gradingScalePending ? <p className="mp-nota-escala">{t('myProgram.grade.scaleNote')}</p> : null}
      </section>

      <section className="mp-calendario">
        <div className="section-header-row">
          <div>
            <h3>{t('myProgram.calendar.title')}</h3>
            <p className="row-subtitle">{t('myProgram.calendar.subtitle')}</p>
          </div>
        </div>

        {semanas.length === 0 ? (
          <p>{t('myProgram.calendar.noGrid')}</p>
        ) : (
          <>
            {semana ? (
              <article className="mp-semana-actual">
                <p className="mp-eyebrow">{t('myProgram.calendar.currentWeek')}</p>
                <h4>{t('myProgram.calendar.week', { n: semana.week })}</h4>
                <p className="row-subtitle">
                  {t('myProgram.calendar.weekOf', {
                    inicio: fecha(semana.startsOn, locale),
                    fin: fecha(semana.endsOn, locale)
                  })}
                  {semana.shifted ? ` · ${t('myProgram.calendar.shifted')}` : ''}
                </p>
                <p className="mp-plazos-titulo">{t('myProgram.calendar.upcoming')}</p>
                {semana.deadlines.length === 0 ? (
                  <p className="mp-sin-dato">{t('myProgram.calendar.noUpcoming')}</p>
                ) : (
                  <ul className="mp-plazos">
                    {semana.deadlines.map((plazo) => {
                      const vencido = new Date(plazo.dueAt).getTime() < Date.now();
                      return (
                        <li key={plazo.key} className={vencido ? 'mp-plazo vencido' : 'mp-plazo'}>
                          <span>{locale === 'en' ? plazo.labelEn : plazo.labelEs}</span>
                          <strong>{fechaHora(plazo.dueAt, locale)}</strong>
                          {vencido ? <em>{t('myProgram.calendar.past')}</em> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            ) : null}

            <ol className="mp-semanas">
              {semanas.map((s) => (
                <li key={s.week} className={semana && s.week === semana.week ? 'mp-semana actual' : 'mp-semana'}>
                  <span className="mp-semana-n">{t('myProgram.calendar.week', { n: s.week })}</span>
                  <span className="mp-semana-fechas">
                    {t('myProgram.calendar.weekOf', {
                      inicio: fecha(s.startsOn, locale),
                      fin: fecha(s.endsOn, locale)
                    })}
                  </span>
                  <span className="mp-semana-cierre">
                    {t('myProgram.calendar.closesAt', { fecha: fechaHora(s.closesAt, locale) })}
                  </span>
                  {s.holidays?.length ? <span className="mp-semana-festivo">{t('myProgram.calendar.holiday')}</span> : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </section>
  );
}

/** Una fila del plan de estudios. */
function FilaCurso({
  curso,
  onAbrirAula
}: {
  curso: CursoMatriculado;
  onAbrirAula: (moodleCourseId: number, titulo: string) => void;
}) {
  const { t } = useTranslation();
  const titulo = curso.name ?? curso.shortName ?? t('myCourses.myClassroom');

  return (
    <tr>
      <td>
        <strong>{titulo}</strong>
        {curso.shortName && curso.name ? <span className="mp-codigo">{curso.shortName}</span> : null}
      </td>
      <td>
        <span className={`mp-estado estado-${curso.status}`}>{t(`myProgram.status.${curso.status}`)}</span>
      </td>
      <td>
        {curso.grade ? (
          <span className="mp-nota">
            <strong>{curso.grade}</strong>
            {curso.gradePoints !== null ? (
              <em>{t('myProgram.grade.points', { puntos: curso.gradePoints.toFixed(1) })}</em>
            ) : null}
          </span>
        ) : (
          <span className="mp-sin-dato">{t('myProgram.grade.pending')}</span>
        )}
      </td>
      <td>
        {curso.progressPercent === null ? (
          <span className="mp-sin-dato">{t('myProgram.progress.noShell')}</span>
        ) : (
          <span className="mp-progreso">
            <span className="mp-barra" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.max(0, curso.progressPercent))}%` }} />
            </span>
            <em>
              {t('myProgram.progress.ofModules', {
                hechos: curso.completedModules,
                total: curso.totalModules ?? 0
              })}
            </em>
          </span>
        )}
      </td>
      <td>
        {curso.aulaAccesible ? (
          <button className="go-course-btn mp-entrar" onClick={() => onAbrirAula(curso.moodleCourseId, titulo)}>
            {t('myProgram.aula.open')}
          </button>
        ) : (
          /* Sin aula habilitada no se pinta un botón que daría 403: se dice qué
             pasa. El servidor niega el contenido sin matrícula en Moodle, y la
             interfaz no debe insinuar una puerta que está cerrada. */
          <span className="mp-aula-bloqueada" title={t('myProgram.aula.blockedHelp')}>
            {t('myProgram.aula.blocked')}
          </span>
        )}
      </td>
    </tr>
  );
}
