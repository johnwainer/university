import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AvailableProgramCourse,
  type ProgramComposition,
  type ProgramCourse
} from '../../../lib/api';

/**
 * Composición de programas: qué cursos de Moodle contiene cada programa.
 *
 * El modelo cambió y el programa es ahora la unidad que el estudiante ve y en
 * la que se matricula; los cursos viven dentro. Esta vista es el único sitio
 * desde donde se compone esa relación, así que repite a propósito las
 * validaciones de `apps/api/src/modules/programs/routes.ts` antes de llamar:
 * un rechazo del servidor llega como un error genérico después de un viaje de
 * red, y aquí se puede decir qué falta sin gastarlo. El servidor sigue siendo
 * la autoridad; si rechaza algo que la interfaz no previó, su mensaje se
 * muestra tal cual.
 *
 * Las dos listas se piden siempre juntas. El catálogo de aulas disponibles es
 * justamente el complemento de lo ya asignado, así que mostrar una de las dos
 * sin refrescar la otra deja la pantalla ofreciendo un curso que ya está
 * dentro de un programa.
 */

type Props = {
  token: string;
  /** Permisos de quien está mirando; si 'sis' no es 'edit', todo va en solo lectura. */
  puedeEditar: boolean;
  /** 'es' | 'en' — ordena las listas con las reglas de ese idioma. */
  locale: 'es' | 'en';
};

/** Saca el texto útil de un error de `fetchJson`, que ya trae el detalle del servidor. */
function textoDeError(error: unknown, respaldo: string): string {
  if (error instanceof Error && error.message) return error.message;
  return respaldo;
}

/**
 * Devuelve la lista con el elemento de `indice` movido `salto` posiciones.
 *
 * Se trabaja sobre una copia porque el resultado se usa para pintar antes de
 * que el servidor confirme: si la petición falla hay que poder volver al
 * arreglo anterior sin haberlo mutado.
 */
function conElementoMovido<T>(lista: T[], indice: number, salto: number): T[] {
  const destino = indice + salto;
  if (destino < 0 || destino >= lista.length) return lista;
  const copia = [...lista];
  const [elemento] = copia.splice(indice, 1);
  copia.splice(destino, 0, elemento);
  return copia;
}

export function ProgramsView({ token, puedeEditar, locale }: Props) {
  const { t } = useTranslation();

  const [programas, setProgramas] = useState<ProgramComposition[]>([]);
  const [disponibles, setDisponibles] = useState<AvailableProgramCourse[]>([]);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  /** Error de una acción concreta (vincular, quitar, reordenar), aparte del de carga. */
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [programaSeleccionado, setProgramaSeleccionado] = useState<string | null>(null);
  const [cursoAVincular, setCursoAVincular] = useState<string>('');

  const limpiarMensajes = useCallback(() => {
    setErrorAccion(null);
    setAviso(null);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const [respComposicion, respDisponibles] = await Promise.all([
        api.admin.programComposition(token),
        api.admin.programAvailableCourses(token)
      ]);
      setProgramas(respComposicion.programs);
      setDisponibles(respDisponibles.courses);
    } catch (error) {
      setErrorCarga(textoDeError(error, t('admin.programs.estado.errorCarga')));
    } finally {
      setCargando(false);
    }
  }, [token, t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Las aulas disponibles se ordenan por nombre corto y no por id.
   *
   * El servidor las entrega por `moodle_course_id`, que es orden de creación en
   * Moodle y no dice nada a quien busca un curso por su nombre en un
   * desplegable. Se usa un colador del idioma activo para que la ñ y los
   * acentos caigan donde los espera quien lee.
   */
  const disponiblesOrdenadas = useMemo(() => {
    const colador = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    return [...disponibles].sort((a, b) => colador.compare(a.short_name, b.short_name));
  }, [disponibles, locale]);

  const programaActual = useMemo(
    () => programas.find((programa) => programa.id === programaSeleccionado) ?? null,
    [programas, programaSeleccionado]
  );

  /**
   * Programas que se quedaron sin ningún curso.
   *
   * Se calcula sobre la lista entera y no sólo sobre el seleccionado porque el
   * aviso tiene que verse al entrar: un programa sin cursos no tiene nada que
   * cursar y el estudiante que se matricule verá una ficha vacía.
   */
  const programasVacios = useMemo(
    () => programas.filter((programa) => programa.courses.length === 0),
    [programas]
  );

  const seleccionarPrograma = useCallback(
    (id: string) => {
      limpiarMensajes();
      setProgramaSeleccionado(id);
      // El desplegable de aulas se vacía al cambiar de programa: la selección
      // anterior se hizo pensando en otro destino.
      setCursoAVincular('');
    },
    [limpiarMensajes]
  );

  /** Refresca ambas listas tras una operación, conservando el programa abierto. */
  const refrescar = useCallback(async () => {
    const [respComposicion, respDisponibles] = await Promise.all([
      api.admin.programComposition(token),
      api.admin.programAvailableCourses(token)
    ]);
    setProgramas(respComposicion.programs);
    setDisponibles(respDisponibles.courses);
  }, [token]);

  const vincular = useCallback(async () => {
    if (!programaActual || !puedeEditar) return;

    // El servidor exige un entero positivo; el valor viene de un <select> y
    // podría ser cadena vacía si se pulsa sin elegir.
    const idCurso = Number(cursoAVincular);
    if (!Number.isInteger(idCurso) || idCurso <= 0) {
      setErrorAccion(t('admin.programs.validacion.sinCurso'));
      return;
    }

    setOcupado(true);
    limpiarMensajes();
    try {
      // El nuevo curso va al final: `sortOrder` es el número de cursos que ya
      // tiene el programa, de modo que añadir no reordena lo existente.
      await api.admin.linkProgramCourse(token, programaActual.id, {
        moodleCourseId: idCurso,
        sortOrder: programaActual.courses.length
      });
      await refrescar();
      setCursoAVincular('');
      setAviso(t('admin.programs.cursos.vinculado'));
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.programs.cursos.errorVincular')));
      // Un 409 significa que otro programa se quedó con ese curso desde la
      // última carga, así que la lista de disponibles que tenemos es vieja.
      await refrescar().catch(() => undefined);
    } finally {
      setOcupado(false);
    }
  }, [programaActual, puedeEditar, cursoAVincular, token, refrescar, t, limpiarMensajes]);

  const quitar = useCallback(
    async (curso: ProgramCourse) => {
      if (!programaActual || !puedeEditar) return;
      setOcupado(true);
      limpiarMensajes();
      try {
        await api.admin.unlinkProgramCourse(token, programaActual.id, curso.moodleCourseId);
        await refrescar();
        setAviso(t('admin.programs.cursos.quitado', { curso: curso.shortName }));
      } catch (error) {
        setErrorAccion(textoDeError(error, t('admin.programs.cursos.errorQuitar')));
      } finally {
        setOcupado(false);
      }
    },
    [programaActual, puedeEditar, token, refrescar, t, limpiarMensajes]
  );

  const mover = useCallback(
    async (indice: number, salto: number) => {
      if (!programaActual || !puedeEditar) return;
      const reordenados = conElementoMovido(programaActual.courses, indice, salto);
      // Si el elemento ya estaba en el extremo no hay nada que mandar.
      if (reordenados === programaActual.courses) return;

      const anteriores = programaActual.courses;
      const idPrograma = programaActual.id;

      // Se pinta el nuevo orden antes de la respuesta para que la flecha
      // responda al instante; si el servidor falla se restaura el anterior.
      setProgramas((previos) =>
        previos.map((programa) =>
          programa.id === idPrograma ? { ...programa, courses: reordenados } : programa
        )
      );
      setOcupado(true);
      limpiarMensajes();
      try {
        await api.admin.reorderProgramCourses(
          token,
          idPrograma,
          reordenados.map((curso) => curso.moodleCourseId)
        );
        setAviso(t('admin.programs.cursos.reordenado'));
      } catch (error) {
        setProgramas((previos) =>
          previos.map((programa) =>
            programa.id === idPrograma ? { ...programa, courses: anteriores } : programa
          )
        );
        setErrorAccion(textoDeError(error, t('admin.programs.cursos.errorReordenar')));
      } finally {
        setOcupado(false);
      }
    },
    [programaActual, puedeEditar, token, t, limpiarMensajes]
  );

  // --- Estados globales ------------------------------------------------------

  if (cargando) {
    return (
      <div className="ad-card">
        <div className="ad-card-body">
          <p className="ad-empty">{t('admin.programs.estado.cargando')}</p>
        </div>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.programs.titulo')}</h2>
        </div>
        <div className="ad-card-body">
          <p className="ad-note" role="alert">
            {errorCarga}
          </p>
          <div className="ad-toolbar">
            <button type="button" className="ad-btn ad-btn-primary" onClick={() => void cargar()}>
              {t('admin.programs.estado.reintentar')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.programs.titulo')}</h2>
          <p>{t('admin.programs.descripcion')}</p>
        </div>
        <div className="ad-card-body">
          {!puedeEditar ? <p className="ad-note">{t('admin.programs.estado.soloLectura')}</p> : null}

          {programasVacios.length > 0 ? (
            <p className="ad-note" role="alert">
              {t('admin.programs.aviso.sinCursos', {
                count: programasVacios.length,
                programas: programasVacios.map((programa) => programa.code).join(', ')
              })}
            </p>
          ) : null}

          {errorAccion ? (
            <p className="ad-note" role="alert">
              {errorAccion}
            </p>
          ) : null}
          {aviso ? (
            <p className="ad-note" role="status">
              {aviso}
            </p>
          ) : null}

          <div className="ad-toolbar">
            <button type="button" className="ad-btn ad-btn-ghost" disabled={ocupado} onClick={() => void cargar()}>
              {t('admin.programs.estado.recargar')}
            </button>
          </div>
        </div>
      </div>

      <div className="ad-grid ad-grid-2">
        <div className="ad-card">
          <div className="ad-card-head">
            <h3>{t('admin.programs.lista.titulo')}</h3>
            <p>{t('admin.programs.lista.total', { count: programas.length })}</p>
          </div>
          <div className="ad-card-body">
            {programas.length === 0 ? (
              <p className="ad-empty">{t('admin.programs.lista.vacio')}</p>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <caption>{t('admin.programs.lista.titulo')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.programs.lista.colCodigo')}</th>
                      <th scope="col">{t('admin.programs.lista.colNombre')}</th>
                      <th scope="col">{t('admin.programs.lista.colEstado')}</th>
                      <th scope="col">{t('admin.programs.lista.colCursos')}</th>
                      <th scope="col">{t('admin.programs.lista.colAcciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programas.map((programa) => (
                      <tr key={programa.id}>
                        <th scope="row">{programa.code}</th>
                        <td>{programa.name}</td>
                        <td>
                          <span className={`ad-badge ad-badge-${programa.is_active ? 'ok' : 'off'}`}>
                            {programa.is_active
                              ? t('admin.programs.lista.activo')
                              : t('admin.programs.lista.inactivo')}
                          </span>
                        </td>
                        <td>
                          {programa.courses.length === 0 ? (
                            <span className="ad-badge ad-badge-warn">
                              {t('admin.programs.lista.sinCursos')}
                            </span>
                          ) : (
                            t('admin.programs.lista.numCursos', { count: programa.courses.length })
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ad-btn ad-btn-ghost"
                            aria-pressed={programaSeleccionado === programa.id}
                            onClick={() => seleccionarPrograma(programa.id)}
                          >
                            {t('admin.programs.lista.gestionar')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="ad-card">
          <div className="ad-card-head">
            <h3>
              {programaActual
                ? t('admin.programs.cursos.tituloCon', {
                    codigo: programaActual.code,
                    nombre: programaActual.name
                  })
                : t('admin.programs.cursos.titulo')}
            </h3>
            <p>{t('admin.programs.cursos.descripcion')}</p>
          </div>
          <div className="ad-card-body">
            {!programaActual ? (
              <p className="ad-empty">{t('admin.programs.cursos.sinSeleccion')}</p>
            ) : (
              <>
                {programaActual.courses.length === 0 ? (
                  <p className="ad-note" role="alert">
                    {t('admin.programs.aviso.esteSinCursos', { codigo: programaActual.code })}
                  </p>
                ) : (
                  <div className="ad-table-wrap">
                    <table className="ad-table">
                      <caption>
                        {t('admin.programs.cursos.tituloCon', {
                          codigo: programaActual.code,
                          nombre: programaActual.name
                        })}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('admin.programs.cursos.colOrden')}</th>
                          <th scope="col">{t('admin.programs.cursos.colCurso')}</th>
                          <th scope="col">{t('admin.programs.cursos.colVisible')}</th>
                          <th scope="col">{t('admin.programs.cursos.colAcciones')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {programaActual.courses.map((curso, indice) => (
                          <tr key={curso.moodleCourseId}>
                            <th scope="row">{indice + 1}</th>
                            <td>
                              {curso.shortName}
                              <br />
                              {curso.fullName}
                            </td>
                            <td>
                              <span className={`ad-badge ad-badge-${curso.visible ? 'ok' : 'off'}`}>
                                {curso.visible
                                  ? t('admin.programs.cursos.visible')
                                  : t('admin.programs.cursos.oculto')}
                              </span>
                            </td>
                            <td>
                              <div className="ad-toolbar">
                                <button
                                  type="button"
                                  className="ad-btn ad-btn-ghost"
                                  disabled={!puedeEditar || ocupado || indice === 0}
                                  onClick={() => void mover(indice, -1)}
                                >
                                  {t('admin.programs.cursos.subir')}
                                </button>
                                <button
                                  type="button"
                                  className="ad-btn ad-btn-ghost"
                                  disabled={
                                    !puedeEditar ||
                                    ocupado ||
                                    indice === programaActual.courses.length - 1
                                  }
                                  onClick={() => void mover(indice, 1)}
                                >
                                  {t('admin.programs.cursos.bajar')}
                                </button>
                                <button
                                  type="button"
                                  className="ad-btn ad-btn-danger"
                                  disabled={!puedeEditar || ocupado}
                                  onClick={() => void quitar(curso)}
                                >
                                  {t('admin.programs.cursos.quitar')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="ad-field">
                  <label htmlFor="programas-curso-disponible">
                    {t('admin.programs.anadir.etiqueta')}
                  </label>
                  <select
                    id="programas-curso-disponible"
                    className="ad-select"
                    value={cursoAVincular}
                    disabled={!puedeEditar || ocupado || disponibles.length === 0}
                    aria-describedby="programas-curso-ayuda"
                    onChange={(evento) => setCursoAVincular(evento.target.value)}
                  >
                    <option value="">{t('admin.programs.anadir.elige')}</option>
                    {disponiblesOrdenadas.map((curso) => (
                      <option key={curso.moodle_course_id} value={String(curso.moodle_course_id)}>
                        {curso.short_name} — {curso.full_name}
                      </option>
                    ))}
                  </select>
                  <p id="programas-curso-ayuda" className="ad-note">
                    {disponibles.length === 0
                      ? t('admin.programs.anadir.sinDisponibles')
                      : t('admin.programs.anadir.ayuda', { count: disponibles.length })}
                  </p>
                </div>

                <div className="ad-toolbar">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary"
                    disabled={!puedeEditar || ocupado || !cursoAVincular}
                    onClick={() => void vincular()}
                  >
                    {t('admin.programs.anadir.boton')}
                  </button>
                </div>

                <p className="ad-note">{t('admin.programs.cursos.notaOrden')}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProgramsView;
