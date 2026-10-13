import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type EscalaResponse,
  type MatriculaRegistraduria
} from '../../../lib/api';

/**
 * Registraduría: registrar la calificación de cada matrícula del periodo.
 *
 * Esta pantalla cierra el último hueco de la plataforma del estudiante. La
 * columna `grade` de `student_enrollments` existía desde el principio y no
 * tenía ningún escritor: ni ruta de API, ni pantalla. El expediente, el
 * promedio y la auditoría de grado leen esa columna, así que los tres estaban
 * condenados a salir vacíos. Y no se puede traer del libro de calificaciones de
 * Moodle: de las 21 funciones del servicio web ninguna es `gradereport_*`.
 *
 * Dos cosas deliberadas:
 *
 * - **Sólo se manda la letra.** Los puntos y el estado de la matrícula los
 *   deriva el servidor con su escala. Si los mandara esta pantalla podrían
 *   contradecirse —una `A` con cero puntos, una `F` que sigue «en curso»— y la
 *   auditoría de grado quedaría mintiendo sin que nada fallara.
 * - **La columna de acceso al aula se muestra aunque no se pueda editar.** Es
 *   el hecho de Moodle, separado de la matrícula de la plataforma, y mientras
 *   la matrícula en Moodle siga pendiente de habilitarse quien califica tiene
 *   que ver que el estudiante está matriculado y aún no ha podido entrar.
 */

type Props = {
  token: string;
  /** El permiso que decide si se puede calificar es el de la sección `registraduria`. */
  puedeEditar: boolean;
  locale: 'es' | 'en';
};

function textoDeError(error: unknown, respaldo: string): string {
  if (error instanceof Error && error.message) return error.message;
  return respaldo;
}

export function RegistrarView({ token, puedeEditar, locale }: Props) {
  const { t } = useTranslation();

  const [matriculas, setMatriculas] = useState<MatriculaRegistraduria[]>([]);
  const [escala, setEscala] = useState<EscalaResponse | null>(null);
  const [periodo, setPeriodo] = useState<{ code: string; name: string } | null>(null);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Id de la matrícula que se está guardando, para deshabilitar sólo esa fila. */
  const [guardando, setGuardando] = useState<string | null>(null);

  const [filtroPrograma, setFiltroPrograma] = useState<string>('');
  const [busqueda, setBusqueda] = useState<string>('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      // Las tres juntas: la escala y el periodo encabezan la pantalla y sin
      // ellos la tabla no se puede interpretar.
      const [e, p, m] = await Promise.all([
        api.admin.gradingScale(token),
        api.admin.registrarTerm(token),
        api.admin.registrarEnrollments(token)
      ]);
      setEscala(e);
      setPeriodo(p.term ? { code: p.term.code, name: p.term.name } : null);
      setMatriculas(m.enrollments);
    } catch (error) {
      setErrorCarga(textoDeError(error, t('admin.registrar.loadError')));
    } finally {
      setCargando(false);
    }
  }, [token, t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const programas = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const m of matriculas) {
      if (m.program_code) vistos.set(m.program_code, m.program_name ?? m.program_code);
    }
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [matriculas, locale]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return matriculas.filter((m) => {
      if (filtroPrograma && m.program_code !== filtroPrograma) return false;
      if (!q) return true;
      return (
        m.student_name.toLowerCase().includes(q) ||
        m.student_email.toLowerCase().includes(q)
      );
    });
  }, [matriculas, filtroPrograma, busqueda]);

  const calificar = async (matricula: MatriculaRegistraduria, letra: string | null) => {
    setGuardando(matricula.id);
    setErrorAccion(null);
    setAviso(null);
    try {
      const r = await api.admin.setGrade(token, matricula.id, letra);
      // Se refresca con lo que devolvió el servidor, no con lo que se pidió:
      // el estado y los puntos los decidió él.
      setMatriculas((actuales) =>
        actuales.map((m) =>
          m.id === matricula.id
            ? {
                ...m,
                grade: r.enrollment.grade,
                grade_points: r.enrollment.grade_points,
                status: r.enrollment.status,
                completed_at: r.enrollment.completed_at
              }
            : m
        )
      );
      setAviso(letra === null ? t('admin.registrar.grade.cleared') : t('admin.registrar.grade.saved'));
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.registrar.loadError')));
    } finally {
      setGuardando(null);
    }
  };

  if (cargando) {
    return (
      <section className="ad-card">
        <div className="ad-card-body">
          <p>{t('common.loading', { defaultValue: '…' })}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ad-card">
      <div className="ad-card-head">
        <div>
          <h2>{t('admin.registrar.title')}</h2>
          <p>{t('admin.registrar.subtitle')}</p>
        </div>
        <div className="ad-stat">
          <span className="ad-stat-etiqueta">{t('admin.registrar.term')}</span>
          <span className="ad-stat-valor">
            {periodo ? periodo.name : t('admin.registrar.noTerm')}
          </span>
        </div>
      </div>

      <div className="ad-card-body">
        {errorCarga ? <p className="ad-note">{errorCarga}</p> : null}
        {errorAccion ? <p className="ad-note">{errorAccion}</p> : null}
        {aviso ? <p className="ad-note">{aviso}</p> : null}

        <div className="ad-toolbar">
          <label className="ad-field">
            {t('admin.registrar.filters.program')}
            <select
              className="ad-select"
              value={filtroPrograma}
              onChange={(e) => setFiltroPrograma(e.target.value)}
            >
              <option value="">{t('admin.registrar.filters.allPrograms')}</option>
              {programas.map(([code, nombre]) => (
                <option key={code} value={code}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="ad-field">
            {t('admin.registrar.filters.student')}
            <input
              className="ad-input"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t('admin.registrar.filters.search')}
            />
          </label>
        </div>

        {visibles.length === 0 ? (
          <div className="ad-empty">
            <p>{t('admin.registrar.empty')}</p>
            <p>{t('admin.registrar.emptyHelp')}</p>
          </div>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>{t('admin.registrar.table.student')}</th>
                  <th>{t('admin.registrar.table.program')}</th>
                  <th>{t('admin.registrar.table.course')}</th>
                  <th>{t('admin.registrar.table.credits')}</th>
                  <th>{t('admin.registrar.table.status')}</th>
                  <th>{t('admin.registrar.table.classroom')}</th>
                  <th>{t('admin.registrar.table.grade')}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.student_name}</strong>
                      <br />
                      <span className="ad-stat-etiqueta">{m.student_email}</span>
                    </td>
                    <td>{m.program_name ?? m.program_code ?? '—'}</td>
                    <td>{m.course_name ?? m.course_short_name ?? `#${m.moodle_course_id}`}</td>
                    <td>{m.credit_hours}</td>
                    <td>
                      <span className="ad-badge">{t(`admin.registrar.status.${m.status}`)}</span>
                    </td>
                    <td>
                      {/* El punto de color es un refuerzo, no el dato: el texto
                          va al lado, como define `admin-ui.css`. Quien no
                          distingue el color sigue leyendo el estado. */}
                      <span
                        className={
                          m.aula_accesible ? 'ad-semaforo ad-semaforo-ok' : 'ad-semaforo ad-semaforo-off'
                        }
                        aria-hidden="true"
                      />
                      <span>
                        {m.aula_accesible
                          ? t('admin.registrar.classroom.ok')
                          : t('admin.registrar.classroom.blocked')}
                      </span>
                    </td>
                    <td>
                      <div className="ad-toolbar">
                        <select
                          className="ad-select"
                          value={m.grade ?? ''}
                          disabled={!puedeEditar || guardando === m.id}
                          onChange={(e) =>
                            void calificar(m, e.target.value === '' ? null : e.target.value)
                          }
                        >
                          <option value="">{t('admin.registrar.grade.none')}</option>
                          {(escala?.escala ?? []).map((n) => (
                            <option key={n.letra} value={n.letra}>
                              {n.letra}
                              {n.puntos === null ? '' : ` · ${n.puntos.toFixed(1)}`} —{' '}
                              {locale === 'en' ? n.descripcionEn : n.descripcionEs}
                            </option>
                          ))}
                        </select>
                        {guardando === m.id ? (
                          <span className="ad-stat-etiqueta">{t('admin.registrar.grade.saving')}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* La escala se rotula como lo que es: la estándar de 4,0, y TFU no ha
            confirmado la suya. Es el mismo criterio con el que las gráficas del
            panel van rotuladas como vista previa de la Etapa V. */}
        {escala?.pendienteDeConfirmacion ? (
          <p className="ad-note">{locale === 'en' ? escala.notaEn : escala.notaEs}</p>
        ) : null}
        <p className="ad-note">{t('admin.registrar.grade.derived')}</p>
      </div>
    </section>
  );
}
