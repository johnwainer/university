import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Consultas del formulario público, con su historial.
 *
 * Esta pantalla es la respuesta a la pregunta de TFU: «is this an email or
 * does it generate a ticket that must be closed keeping all information about
 * the communication?». Antes la bandeja vivía dentro del checklist CIE y sólo
 * dejaba cambiar un estado; de la comunicación no quedaba nada.
 *
 * Tres decisiones de diseño que no son cosméticas:
 *
 *   - El historial es lo que ocupa el espacio. Lo que el equipo necesita ver
 *     al abrir una consulta no es el formulario otra vez, sino qué se le ha
 *     dicho ya a esa persona.
 *   - La nota interna y la respuesta son dos botones distintos, nunca uno con
 *     una casilla. Mandar por error a la persona una nota interna es un daño
 *     que no se deshace.
 *   - Si el correo no salió, se dice en la propia entrada del historial y con
 *     el motivo. Mientras TFU no entregue SMTP, TODAS las respuestas quedarán
 *     marcadas como no enviadas: eso es información, no un fallo que esconder.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

type Estado = 'new' | 'in_progress' | 'closed' | 'spam';

type Consulta = {
  id: string;
  reference: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  locale: string;
  status: Estado;
  programName: string | null;
  programCode: string | null;
  handledBy: string | null;
  assignedTo: string | null;
  lastActivityAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  eventCount: number;
  replyCount: number;
};

type Evento = {
  id: string;
  kind: 'note' | 'reply' | 'status' | 'assignment';
  body: string | null;
  authorEmail: string | null;
  emailTo: string | null;
  emailStatus: 'sent' | 'failed' | 'not_configured' | null;
  emailDetail: string | null;
  createdAt: string;
};

type Contadores = Record<Estado, number>;

async function apiFetch<T>(
  token: string,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const raw = await response.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { message?: string; error?: string };
          const detail = parsed.message ?? parsed.error;
          if (detail) message = `${message} - ${detail}`;
        } catch {
          message = `${message} - ${raw}`;
        }
      }
    } catch {
      /* el cuerpo del error es opcional */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

const ESTADOS: Estado[] = ['new', 'in_progress', 'closed', 'spam'];

export function MensajesView({
  token,
  puedeEditar,
  setError,
  setInfo
}: {
  token: string;
  puedeEditar: boolean;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Consulta[]>([]);
  const [counts, setCounts] = useState<Contadores>({ new: 0, in_progress: 0, closed: 0, spam: 0 });
  const [filtro, setFiltro] = useState<Estado | 'todas'>('new');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(false);

  const [abierta, setAbierta] = useState<Consulta | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtro !== 'todas') params.set('status', filtro);
      if (busqueda.trim()) params.set('search', busqueda.trim());
      const data = await apiFetch<{ items: Consulta[]; counts: Contadores }>(
        token,
        `/admin/contact-messages${params.toString() ? `?${params.toString()}` : ''}`
      );
      setItems(data.items ?? []);
      if (data.counts) setCounts(data.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, [token, filtro, busqueda, setError]);

  useEffect(() => {
    void cargarLista();
    // La búsqueda se dispara con el botón, no en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filtro]);

  const abrir = async (consulta: Consulta) => {
    setTexto('');
    try {
      const data = await apiFetch<{ message: Consulta; events: Evento[] }>(
        token,
        `/admin/contact-messages/${encodeURIComponent(consulta.id)}`
      );
      setAbierta(data.message);
      setEventos(data.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const escribir = async (kind: 'note' | 'reply') => {
    if (!abierta || texto.trim().length < 2) return;
    setEnviando(true);
    setError(null);
    setInfo(null);
    try {
      const data = await apiFetch<{ event: Evento; message: Consulta }>(
        token,
        `/admin/contact-messages/${encodeURIComponent(abierta.id)}/events`,
        { method: 'POST', body: { kind, body: texto.trim() } }
      );
      setEventos((actuales) => [...actuales, data.event]);
      setAbierta(data.message);
      setTexto('');
      void cargarLista();
      if (kind === 'reply') {
        // El resultado del envío se dice tal cual: un «enviado» falso es peor
        // que un «registrado sin enviar» verdadero.
        setInfo(
          data.event.emailStatus === 'sent'
            ? t('admin.mensajes.respuestaEnviada', { correo: data.event.emailTo })
            : t('admin.mensajes.respuestaRegistrada')
        );
      } else {
        setInfo(t('admin.mensajes.notaGuardada'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const cambiarEstado = async (status: Estado) => {
    if (!abierta) return;
    try {
      const data = await apiFetch<{ message: Consulta }>(
        token,
        `/admin/contact-messages/${encodeURIComponent(abierta.id)}/status`,
        { method: 'PATCH', body: { status } }
      );
      setAbierta(data.message);
      void abrir(data.message);
      void cargarLista();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fecha = (valor: string | null) =>
    valor ? new Date(valor).toLocaleString(i18n.language) : '—';

  const etiquetaEstado = (estado: Estado) => t(`admin.mensajes.estados.${estado}`);

  const claseSemaforo = (estado: Estado) =>
    estado === 'closed' ? 'ad-badge-ok' : estado === 'spam' ? 'ad-badge-off' : 'ad-badge-warn';

  return (
    <section className="grid-2">
      <div>
        <h2>{t('admin.mensajes.titulo', { total: items.length })}</h2>
        <p className="ad-note">{t('admin.mensajes.queEsEstaSeccion')}</p>

        <div className="inline-actions" style={{ marginBottom: '12px', flexWrap: 'wrap' }}>
          {(['todas', ...ESTADOS] as Array<Estado | 'todas'>).map((estado) => (
            <button
              key={estado}
              className={filtro === estado ? '' : 'ghost'}
              onClick={() => setFiltro(estado)}
            >
              {estado === 'todas'
                ? t('admin.mensajes.filtroTodas')
                : `${etiquetaEstado(estado)} (${counts[estado] ?? 0})`}
            </button>
          ))}
        </div>

        <div className="inline-actions" style={{ marginBottom: '12px' }}>
          <input
            value={busqueda}
            placeholder={t('admin.mensajes.buscar')}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void cargarLista();
            }}
          />
          <button onClick={() => void cargarLista()} disabled={cargando}>
            {cargando ? t('admin.mensajes.cargando') : t('admin.mensajes.actualizar')}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.mensajes.colReferencia')}</th>
                <th>{t('admin.mensajes.colPersona')}</th>
                <th>{t('admin.mensajes.colEstado')}</th>
                <th>{t('admin.mensajes.colActividad')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4}>{t('admin.mensajes.vacio')}</td>
                </tr>
              ) : (
                items.map((consulta) => (
                  <tr
                    key={consulta.id}
                    onClick={() => void abrir(consulta)}
                    style={{
                      cursor: 'pointer',
                      fontWeight: consulta.status === 'new' ? 600 : 400
                    }}
                  >
                    <td>{consulta.reference ?? '—'}</td>
                    <td>
                      {consulta.fullName}
                      <br />
                      <small>{consulta.email}</small>
                      {consulta.programName ? (
                        <>
                          <br />
                          <small>{consulta.programName}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className={`ad-badge ${claseSemaforo(consulta.status)}`}>
                        {etiquetaEstado(consulta.status)}
                      </span>
                      {/* Las respuestas enviadas se cuentan aparte de las
                          notas: es lo que distingue «atendida» de «mirada». */}
                      {consulta.replyCount > 0 ? (
                        <>
                          <br />
                          <small>{t('admin.mensajes.respuestasCuenta', { total: consulta.replyCount })}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{fecha(consulta.lastActivityAt ?? consulta.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2>{t('admin.mensajes.detalleTitulo')}</h2>
        {!abierta ? (
          <p className="ad-empty">{t('admin.mensajes.detalleVacio')}</p>
        ) : (
          <article className="ad-card">
            <div className="ad-card-body">
              <h3>
                {abierta.reference} · {abierta.fullName}
              </h3>
              <p>
                <small>
                  {abierta.email}
                  {abierta.phone ? ` · ${abierta.phone}` : ''} ·{' '}
                  {t('admin.mensajes.recibida', { fecha: fecha(abierta.createdAt) })}
                </small>
              </p>
              {abierta.programName ? (
                <p>
                  <small>{t('admin.mensajes.sobrePrograma', { programa: abierta.programName })}</small>
                </p>
              ) : null}

              {abierta.subject ? (
                <p style={{ margin: '10px 0 2px' }}>
                  <strong>{abierta.subject}</strong>
                </p>
              ) : null}
              <p className="ad-note" style={{ whiteSpace: 'pre-wrap' }}>{abierta.message}</p>

              {puedeEditar ? (
                <div className="inline-actions" style={{ flexWrap: 'wrap', marginBottom: '12px' }}>
                  {ESTADOS.map((estado) => (
                    <button
                      key={estado}
                      className={abierta.status === estado ? '' : 'ghost'}
                      onClick={() => void cambiarEstado(estado)}
                    >
                      {etiquetaEstado(estado)}
                    </button>
                  ))}
                </div>
              ) : null}

              <h4>{t('admin.mensajes.historial')}</h4>
              {eventos.length === 0 ? (
                <p className="ad-empty">{t('admin.mensajes.historialVacio')}</p>
              ) : (
                <ol className="ad-timeline">
                  {eventos.map((evento) => (
                    <li key={evento.id} className={`ad-timeline-item kind-${evento.kind}`}>
                      <div className="ad-timeline-head">
                        <strong>{t(`admin.mensajes.tipos.${evento.kind}`)}</strong>
                        <small>
                          {evento.authorEmail ?? t('admin.mensajes.sistema')} · {fecha(evento.createdAt)}
                        </small>
                      </div>
                      {evento.body ? (
                        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{evento.body}</p>
                      ) : null}
                      {evento.kind === 'reply' ? (
                        <p className="ad-note" style={{ margin: '6px 0 0' }}>
                          {evento.emailStatus === 'sent'
                            ? t('admin.mensajes.envioHecho', { correo: evento.emailTo })
                            : t('admin.mensajes.envioPendiente', {
                                motivo: evento.emailDetail ?? t('admin.mensajes.sinMotivo')
                              })}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}

              {puedeEditar ? (
                <div className="ad-field" style={{ marginTop: '14px' }}>
                  <label htmlFor="mensaje-texto">{t('admin.mensajes.escribir')}</label>
                  <textarea
                    id="mensaje-texto"
                    rows={4}
                    value={texto}
                    maxLength={5000}
                    placeholder={t('admin.mensajes.escribirAyuda')}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                  {/* Dos botones distintos a propósito: ver nota del archivo. */}
                  <div className="inline-actions" style={{ marginTop: '8px' }}>
                    <button onClick={() => void escribir('reply')} disabled={enviando || texto.trim().length < 2}>
                      {enviando ? t('admin.mensajes.guardando') : t('admin.mensajes.responder')}
                    </button>
                    <button
                      className="ghost"
                      onClick={() => void escribir('note')}
                      disabled={enviando || texto.trim().length < 2}
                    >
                      {t('admin.mensajes.notaInterna')}
                    </button>
                  </div>
                  <small className="ad-note">{t('admin.mensajes.avisoEnvio')}</small>
                </div>
              ) : null}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
