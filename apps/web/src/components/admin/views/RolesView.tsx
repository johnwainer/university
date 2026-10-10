import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AdminPanelUser,
  type AdminRole,
  type AdminSectionDef,
  type PermissionLevel
} from '../../../lib/api';

/**
 * Gestor de roles y usuarios del panel administrativo.
 *
 * Esta vista es el único sitio desde donde se reparten permisos, así que
 * duplica a propósito las validaciones que ya hace el servidor en
 * `apps/api/src/modules/iam/routes.ts`. No es desconfianza del servidor: es que
 * un rechazo del servidor llega como un error genérico después de un viaje de
 * red, y aquí se puede decir exactamente qué falta antes de intentarlo. El
 * servidor sigue siendo la autoridad; si rechaza algo que la interfaz no
 * previó, su mensaje se muestra tal cual.
 *
 * El catálogo de secciones NO se escribe aquí: se pide a `/admin/iam/sections`.
 * Así la matriz nunca se queda corta ni de más cuando se añade una sección
 * nueva al panel.
 */

/** El orden en que se ofrecen los niveles en cada fila de la matriz. */
const NIVELES: PermissionLevel[] = ['none', 'view', 'edit'];

/** Misma expresión que `rolSchema.key` en el servidor. */
const CLAVE_ROL = /^[a-z0-9-]+$/;
const CLAVE_ROL_MIN = 2;
const CLAVE_ROL_MAX = 40;

/** Mismo mínimo que `usuarioSchema.password` en el servidor. */
const CONTRASENA_MIN = 10;

/**
 * El rol de sistema que no se puede recortar. El servidor lo bloquea por
 * `key`, no por `isSystem`, así que aquí se compara igual por `key`.
 */
const CLAVE_SUPERADMIN = 'superadmin';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Pestana = 'roles' | 'usuarios';

type FormularioRol = {
  modo: 'crear' | 'editar';
  id: string | null;
  /** Se guarda al abrir el formulario para bloquear la clave sin volver a buscar el rol. */
  esSistema: boolean;
  key: string;
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
};

type FormularioUsuario = {
  modo: 'crear' | 'editar';
  id: string | null;
  email: string;
  fullName: string;
  /** En modo editar, vacío significa "no cambiar la contraseña". */
  password: string;
  roleId: string;
  idioma: 'es' | 'en';
  isActive: boolean;
};

type Confirmacion = {
  tipo: 'rol' | 'usuario';
  id: string;
  etiqueta: string;
};

type Props = {
  token: string;
  /** Permisos de quien está mirando; si 'roles' no es 'edit', todo va en solo lectura. */
  puedeEditar: boolean;
  /** 'es' | 'en' — decide si se muestra nameEs o nameEn de roles y secciones. */
  locale: 'es' | 'en';
};

/** Saca el texto útil de un error de `fetchJson`, que ya trae el detalle del servidor. */
function textoDeError(error: unknown, respaldo: string): string {
  if (error instanceof Error && error.message) return error.message;
  return respaldo;
}

/**
 * Construye la matriz completa a partir de lo guardado del rol.
 *
 * Se recorren las secciones del catálogo y no las claves de `permisos` porque
 * un rol recién creado puede no tener fila para una sección añadida después;
 * sin este relleno la fila saldría sin ningún radio marcado.
 */
function matrizDeRol(rol: AdminRole, secciones: AdminSectionDef[]): Record<string, PermissionLevel> {
  const matriz: Record<string, PermissionLevel> = {};
  for (const seccion of secciones) {
    matriz[seccion.id] = rol.permisos[seccion.id] ?? 'none';
  }
  return matriz;
}

function hayCambios(
  borrador: Record<string, PermissionLevel>,
  rol: AdminRole,
  secciones: AdminSectionDef[]
): boolean {
  return secciones.some((seccion) => (rol.permisos[seccion.id] ?? 'none') !== borrador[seccion.id]);
}

export function RolesView({ token, puedeEditar, locale }: Props) {
  const { t } = useTranslation();

  const [pestana, setPestana] = useState<Pestana>('roles');

  const [secciones, setSecciones] = useState<AdminSectionDef[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [usuarios, setUsuarios] = useState<AdminPanelUser[]>([]);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  /** Error de una acción concreta (guardar, borrar…), separado del error de carga. */
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [rolSeleccionado, setRolSeleccionado] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, PermissionLevel>>({});

  const [formRol, setFormRol] = useState<FormularioRol | null>(null);
  const [formUsuario, setFormUsuario] = useState<FormularioUsuario | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const [respSecciones, respRoles, respUsuarios] = await Promise.all([
        api.admin.iam.sections(token),
        api.admin.iam.roles(token),
        api.admin.iam.users(token)
      ]);
      setSecciones(respSecciones.sections);
      setRoles(respRoles.roles);
      setUsuarios(respUsuarios.users);
    } catch (error) {
      setErrorCarga(textoDeError(error, t('admin.roles.estado.errorCarga')));
    } finally {
      setCargando(false);
    }
  }, [token, t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const rolActual = useMemo(
    () => roles.find((rol) => rol.id === rolSeleccionado) ?? null,
    [roles, rolSeleccionado]
  );

  /**
   * Secciones agrupadas para pintar la matriz.
   *
   * La agrupación se hace siempre por `group` (el nombre en español) porque es
   * el identificador estable del grupo; `groupEn` sólo sirve para el rótulo.
   * Agrupar por el nombre traducido partiría los grupos al cambiar de idioma.
   */
  const grupos = useMemo(() => {
    const porClave = new Map<string, { rotulo: string; secciones: AdminSectionDef[] }>();
    for (const seccion of secciones) {
      const actual = porClave.get(seccion.group);
      if (actual) {
        actual.secciones.push(seccion);
      } else {
        porClave.set(seccion.group, {
          rotulo: locale === 'en' ? seccion.groupEn : seccion.group,
          secciones: [seccion]
        });
      }
    }
    return Array.from(porClave.entries()).map(([clave, valor]) => ({ clave, ...valor }));
  }, [secciones, locale]);

  const nombreDeRol = useCallback(
    (rol: AdminRole) => (locale === 'en' ? rol.nameEn : rol.nameEs),
    [locale]
  );

  const nombreDeSeccion = useCallback(
    (seccion: AdminSectionDef) => (locale === 'en' ? seccion.nameEn : seccion.nameEs),
    [locale]
  );

  /** El superadministrador se mira pero no se toca: el servidor rechaza su matriz. */
  const esSuperadmin = rolActual?.key === CLAVE_SUPERADMIN;
  const matrizEditable = puedeEditar && !!rolActual && !esSuperadmin;
  const sucio = useMemo(
    () => (rolActual ? hayCambios(borrador, rolActual, secciones) : false),
    [borrador, rolActual, secciones]
  );

  const etiquetaNivel: Record<PermissionLevel, string> = {
    none: t('admin.roles.niveles.none'),
    view: t('admin.roles.niveles.view'),
    edit: t('admin.roles.niveles.edit')
  };

  const limpiarMensajes = useCallback(() => {
    setErrorAccion(null);
    setAviso(null);
  }, []);

  const seleccionarRol = useCallback(
    (rol: AdminRole) => {
      limpiarMensajes();
      setRolSeleccionado(rol.id);
      setBorrador(matrizDeRol(rol, secciones));
    },
    [secciones, limpiarMensajes]
  );

  const descartarMatriz = useCallback(() => {
    if (!rolActual) return;
    setBorrador(matrizDeRol(rolActual, secciones));
    limpiarMensajes();
  }, [rolActual, secciones, limpiarMensajes]);

  const cambiarNivel = useCallback((seccionId: string, nivel: PermissionLevel) => {
    setBorrador((previo) => ({ ...previo, [seccionId]: nivel }));
  }, []);

  const guardarMatriz = useCallback(async () => {
    if (!rolActual || !matrizEditable) return;
    setOcupado(true);
    limpiarMensajes();
    try {
      const resp = await api.admin.iam.setPermissions(token, rolActual.id, borrador);
      // El servidor devuelve la matriz ya normalizada; se usa esa y no el
      // borrador, para que el indicador de "sin guardar" se apague con el
      // estado real y no con lo que creíamos haber mandado.
      setRoles((previos) =>
        previos.map((rol) => (rol.id === rolActual.id ? { ...rol, permisos: resp.permisos } : rol))
      );
      setBorrador(resp.permisos);
      setAviso(t('admin.roles.matriz.guardado'));
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.roles.matriz.errorGuardar')));
    } finally {
      setOcupado(false);
    }
  }, [rolActual, matrizEditable, token, borrador, t, limpiarMensajes]);

  // --- Roles: crear y editar -------------------------------------------------

  const abrirCrearRol = useCallback(() => {
    limpiarMensajes();
    setFormRol({
      modo: 'crear',
      id: null,
      esSistema: false,
      key: '',
      nameEs: '',
      nameEn: '',
      descriptionEs: '',
      descriptionEn: ''
    });
  }, [limpiarMensajes]);

  const abrirEditarRol = useCallback(
    (rol: AdminRole) => {
      limpiarMensajes();
      setFormRol({
        modo: 'editar',
        id: rol.id,
        esSistema: rol.isSystem,
        key: rol.key,
        nameEs: rol.nameEs,
        nameEn: rol.nameEn,
        descriptionEs: rol.descriptionEs ?? '',
        descriptionEn: rol.descriptionEn ?? ''
      });
    },
    [limpiarMensajes]
  );

  /** Devuelve el primer problema del formulario de rol, o null si está correcto. */
  const validarRol = useCallback(
    (form: FormularioRol): string | null => {
      // La clave sólo se valida cuando se va a enviar: en un rol de sistema no
      // se manda nunca, porque el servidor rechaza cambiarla.
      if (form.modo === 'crear' || !form.esSistema) {
        const clave = form.key.trim();
        if (clave.length < CLAVE_ROL_MIN || clave.length > CLAVE_ROL_MAX) {
          return t('admin.roles.validacion.claveLongitud', { min: CLAVE_ROL_MIN, max: CLAVE_ROL_MAX });
        }
        if (!CLAVE_ROL.test(clave)) return t('admin.roles.validacion.claveFormato');
        const repetida = roles.some(
          (rol) => rol.key === clave && rol.id !== form.id
        );
        if (repetida) return t('admin.roles.validacion.claveRepetida');
      }
      if (!form.nameEs.trim()) return t('admin.roles.validacion.nombreEsVacio');
      if (!form.nameEn.trim()) return t('admin.roles.validacion.nombreEnVacio');
      return null;
    },
    [roles, t]
  );

  const guardarRol = useCallback(async () => {
    if (!formRol || !puedeEditar) return;
    const problema = validarRol(formRol);
    if (problema) {
      setErrorAccion(problema);
      return;
    }
    setOcupado(true);
    limpiarMensajes();
    try {
      const cuerpo: Record<string, unknown> = {
        nameEs: formRol.nameEs.trim(),
        nameEn: formRol.nameEn.trim(),
        descriptionEs: formRol.descriptionEs.trim(),
        descriptionEn: formRol.descriptionEn.trim()
      };
      // La clave de un rol de sistema se omite del cuerpo en vez de mandarse
      // igual: el servidor devuelve 400 en cuanto ve el campo presente.
      if (formRol.modo === 'crear' || !formRol.esSistema) cuerpo.key = formRol.key.trim();

      if (formRol.modo === 'crear') {
        await api.admin.iam.createRole(token, cuerpo);
        setAviso(t('admin.roles.rol.creado'));
      } else if (formRol.id) {
        await api.admin.iam.updateRole(token, formRol.id, cuerpo);
        setAviso(t('admin.roles.rol.actualizado'));
      }
      setFormRol(null);
      await cargar();
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.roles.rol.errorGuardar')));
    } finally {
      setOcupado(false);
    }
  }, [formRol, puedeEditar, validarRol, token, t, cargar, limpiarMensajes]);

  /** Motivo por el que un rol no se puede borrar, o null si sí se puede. */
  const motivoNoBorrable = useCallback(
    (rol: AdminRole): string | null => {
      if (rol.isSystem) return t('admin.roles.rol.noBorrableSistema');
      if (rol.usuarios > 0) return t('admin.roles.rol.noBorrableConUsuarios', { count: rol.usuarios });
      return null;
    },
    [t]
  );

  // --- Usuarios --------------------------------------------------------------

  const abrirCrearUsuario = useCallback(() => {
    limpiarMensajes();
    setFormUsuario({
      modo: 'crear',
      id: null,
      email: '',
      fullName: '',
      password: '',
      roleId: roles[0]?.id ?? '',
      idioma: locale,
      isActive: true
    });
  }, [roles, locale, limpiarMensajes]);

  const abrirEditarUsuario = useCallback(
    (usuario: AdminPanelUser) => {
      limpiarMensajes();
      setFormUsuario({
        modo: 'editar',
        id: usuario.id,
        email: usuario.email,
        fullName: usuario.fullName,
        password: '',
        roleId: usuario.roleId ?? '',
        idioma: usuario.locale,
        isActive: usuario.isActive
      });
    },
    [limpiarMensajes]
  );

  const validarUsuario = useCallback(
    (form: FormularioUsuario): string | null => {
      if (!form.fullName.trim()) return t('admin.roles.validacion.nombreVacio');
      // El correo no se puede cambiar después de crear la cuenta (el servidor
      // no acepta ese campo en PATCH), así que sólo se valida al crear.
      if (form.modo === 'crear') {
        if (!CORREO.test(form.email.trim())) return t('admin.roles.validacion.correoInvalido');
        const repetido = usuarios.some(
          (usuario) => usuario.email.toLowerCase() === form.email.trim().toLowerCase()
        );
        if (repetido) return t('admin.roles.validacion.correoRepetido');
        if (form.password.length < CONTRASENA_MIN) {
          return t('admin.roles.validacion.contrasenaCorta', { min: CONTRASENA_MIN });
        }
      } else if (form.password && form.password.length < CONTRASENA_MIN) {
        // Vacío es válido en edición: significa dejar la contraseña como está.
        return t('admin.roles.validacion.contrasenaCorta', { min: CONTRASENA_MIN });
      }
      if (!form.roleId) return t('admin.roles.validacion.rolVacio');
      return null;
    },
    [usuarios, t]
  );

  const guardarUsuario = useCallback(async () => {
    if (!formUsuario || !puedeEditar) return;
    const problema = validarUsuario(formUsuario);
    if (problema) {
      setErrorAccion(problema);
      return;
    }
    setOcupado(true);
    limpiarMensajes();
    try {
      if (formUsuario.modo === 'crear') {
        await api.admin.iam.createUser(token, {
          email: formUsuario.email.trim(),
          fullName: formUsuario.fullName.trim(),
          password: formUsuario.password,
          roleId: formUsuario.roleId,
          locale: formUsuario.idioma,
          isActive: formUsuario.isActive
        });
        setAviso(t('admin.roles.usuario.creado'));
      } else if (formUsuario.id) {
        const cuerpo: Record<string, unknown> = {
          fullName: formUsuario.fullName.trim(),
          roleId: formUsuario.roleId,
          locale: formUsuario.idioma,
          isActive: formUsuario.isActive
        };
        // Sólo se manda la contraseña si se escribió algo: mandarla vacía la
        // haría fallar la validación de mínimo 10 caracteres del servidor.
        if (formUsuario.password) cuerpo.password = formUsuario.password;
        await api.admin.iam.updateUser(token, formUsuario.id, cuerpo);
        setAviso(t('admin.roles.usuario.actualizado'));
      }
      setFormUsuario(null);
      await cargar();
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.roles.usuario.errorGuardar')));
    } finally {
      setOcupado(false);
    }
  }, [formUsuario, puedeEditar, validarUsuario, token, t, cargar, limpiarMensajes]);

  const alternarActivo = useCallback(
    async (usuario: AdminPanelUser) => {
      if (!puedeEditar) return;
      setOcupado(true);
      limpiarMensajes();
      try {
        await api.admin.iam.updateUser(token, usuario.id, { isActive: !usuario.isActive });
        setAviso(
          usuario.isActive ? t('admin.roles.usuario.desactivado') : t('admin.roles.usuario.activado')
        );
        await cargar();
      } catch (error) {
        setErrorAccion(textoDeError(error, t('admin.roles.usuario.errorGuardar')));
      } finally {
        setOcupado(false);
      }
    },
    [puedeEditar, token, t, cargar, limpiarMensajes]
  );

  // --- Borrado con confirmación ---------------------------------------------

  const confirmarBorrado = useCallback(async () => {
    if (!confirmacion || !puedeEditar) return;
    setOcupado(true);
    limpiarMensajes();
    try {
      if (confirmacion.tipo === 'rol') {
        await api.admin.iam.deleteRole(token, confirmacion.id);
        // Si el rol borrado era el seleccionado, la matriz de la derecha se
        // quedaría apuntando a algo que ya no existe.
        if (rolSeleccionado === confirmacion.id) {
          setRolSeleccionado(null);
          setBorrador({});
        }
        setAviso(t('admin.roles.rol.borrado'));
      } else {
        await api.admin.iam.deleteUser(token, confirmacion.id);
        setAviso(t('admin.roles.usuario.borrado'));
      }
      setConfirmacion(null);
      await cargar();
    } catch (error) {
      setErrorAccion(textoDeError(error, t('admin.roles.estado.errorAccion')));
    } finally {
      setOcupado(false);
    }
  }, [confirmacion, puedeEditar, token, rolSeleccionado, t, cargar, limpiarMensajes]);

  // --- Formato ---------------------------------------------------------------

  const fecha = useCallback(
    (valor: string | null): string => {
      if (!valor) return t('admin.roles.usuario.nunca');
      const d = new Date(valor);
      if (Number.isNaN(d.getTime())) return t('admin.roles.usuario.nunca');
      return d.toLocaleString(locale === 'en' ? 'en-US' : 'es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    },
    [locale, t]
  );

  // --- Estados globales ------------------------------------------------------

  if (cargando) {
    return (
      <div className="ad-card">
        <div className="ad-card-body">
          <p className="ad-empty">{t('admin.roles.estado.cargando')}</p>
        </div>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.roles.titulo')}</h2>
        </div>
        <div className="ad-card-body">
          <p className="ad-note" role="alert">
            {errorCarga}
          </p>
          <button type="button" className="ad-btn ad-btn-primary" onClick={() => void cargar()}>
            {t('admin.roles.estado.reintentar')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="ad-card">
        <div className="ad-card-head">
          <h2>{t('admin.roles.titulo')}</h2>
          <p>{t('admin.roles.descripcion')}</p>
        </div>
        <div className="ad-card-body">
          <div className="ad-tabs" role="tablist" aria-label={t('admin.roles.titulo')}>
            <button
              type="button"
              className="ad-tab"
              role="tab"
              id="tab-roles"
              aria-controls="panel-roles"
              aria-selected={pestana === 'roles'}
              onClick={() => setPestana('roles')}
            >
              {t('admin.roles.pestanas.roles')}
            </button>
            <button
              type="button"
              className="ad-tab"
              role="tab"
              id="tab-usuarios"
              aria-controls="panel-usuarios"
              aria-selected={pestana === 'usuarios'}
              onClick={() => setPestana('usuarios')}
            >
              {t('admin.roles.pestanas.usuarios')}
            </button>
          </div>

          {!puedeEditar ? <p className="ad-note">{t('admin.roles.estado.soloLectura')}</p> : null}
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
        </div>
      </div>

      {confirmacion ? (
        <div className="ad-card">
          <div className="ad-card-head">
            <h3>{t('admin.roles.confirmar.titulo')}</h3>
          </div>
          <div className="ad-card-body">
            <p className="ad-note">
              {confirmacion.tipo === 'rol'
                ? t('admin.roles.confirmar.rol', { nombre: confirmacion.etiqueta })
                : t('admin.roles.confirmar.usuario', { nombre: confirmacion.etiqueta })}
            </p>
            <div className="ad-toolbar">
              <button
                type="button"
                className="ad-btn ad-btn-danger"
                disabled={ocupado}
                onClick={() => void confirmarBorrado()}
              >
                {t('admin.roles.confirmar.borrar')}
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-ghost"
                onClick={() => setConfirmacion(null)}
              >
                {t('admin.roles.confirmar.cancelar')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pestana === 'roles' ? (
        <div id="panel-roles" role="tabpanel" aria-labelledby="tab-roles">
          {formRol ? (
            <div className="ad-card">
              <div className="ad-card-head">
                <h3>
                  {formRol.modo === 'crear'
                    ? t('admin.roles.rol.tituloCrear')
                    : t('admin.roles.rol.tituloEditar')}
                </h3>
              </div>
              <div className="ad-card-body">
                <div className="ad-grid ad-grid-2">
                  <div className="ad-field">
                    <label htmlFor="rol-key">{t('admin.roles.rol.clave')}</label>
                    <input
                      id="rol-key"
                      className="ad-input"
                      type="text"
                      value={formRol.key}
                      maxLength={CLAVE_ROL_MAX}
                      disabled={formRol.esSistema}
                      aria-describedby="rol-key-ayuda"
                      onChange={(e) => setFormRol({ ...formRol, key: e.target.value })}
                    />
                    <p id="rol-key-ayuda" className="ad-note">
                      {formRol.esSistema
                        ? t('admin.roles.rol.claveSistema')
                        : t('admin.roles.rol.claveAyuda')}
                    </p>
                  </div>
                  <div className="ad-field">
                    <label htmlFor="rol-name-es">{t('admin.roles.rol.nombreEs')}</label>
                    <input
                      id="rol-name-es"
                      className="ad-input"
                      type="text"
                      value={formRol.nameEs}
                      onChange={(e) => setFormRol({ ...formRol, nameEs: e.target.value })}
                    />
                  </div>
                  <div className="ad-field">
                    <label htmlFor="rol-name-en">{t('admin.roles.rol.nombreEn')}</label>
                    <input
                      id="rol-name-en"
                      className="ad-input"
                      type="text"
                      value={formRol.nameEn}
                      onChange={(e) => setFormRol({ ...formRol, nameEn: e.target.value })}
                    />
                  </div>
                  <div className="ad-field">
                    <label htmlFor="rol-desc-es">{t('admin.roles.rol.descripcionEs')}</label>
                    <textarea
                      id="rol-desc-es"
                      className="ad-textarea"
                      rows={2}
                      value={formRol.descriptionEs}
                      onChange={(e) => setFormRol({ ...formRol, descriptionEs: e.target.value })}
                    />
                  </div>
                  <div className="ad-field">
                    <label htmlFor="rol-desc-en">{t('admin.roles.rol.descripcionEn')}</label>
                    <textarea
                      id="rol-desc-en"
                      className="ad-textarea"
                      rows={2}
                      value={formRol.descriptionEn}
                      onChange={(e) => setFormRol({ ...formRol, descriptionEn: e.target.value })}
                    />
                  </div>
                </div>
                <div className="ad-toolbar">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary"
                    disabled={ocupado}
                    onClick={() => void guardarRol()}
                  >
                    {ocupado ? t('admin.roles.estado.guardando') : t('admin.roles.rol.guardar')}
                  </button>
                  <button
                    type="button"
                    className="ad-btn ad-btn-ghost"
                    onClick={() => setFormRol(null)}
                  >
                    {t('admin.roles.rol.cancelar')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="ad-grid ad-grid-2">
            <div className="ad-card">
              <div className="ad-card-head">
                <h3>{t('admin.roles.lista.titulo')}</h3>
                <span className="ad-badge">
                  {t('admin.roles.lista.total', { count: roles.length })}
                </span>
              </div>
              <div className="ad-card-body">
                <div className="ad-toolbar">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary"
                    disabled={!puedeEditar || ocupado}
                    onClick={abrirCrearRol}
                  >
                    {t('admin.roles.lista.nuevo')}
                  </button>
                </div>

                {roles.length === 0 ? (
                  <p className="ad-empty">{t('admin.roles.lista.vacio')}</p>
                ) : (
                  <table className="ad-table">
                    <caption>{t('admin.roles.lista.titulo')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('admin.roles.lista.colNombre')}</th>
                        <th scope="col">{t('admin.roles.lista.colClave')}</th>
                        <th scope="col">{t('admin.roles.lista.colUsuarios')}</th>
                        <th scope="col">{t('admin.roles.lista.colAcciones')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((rol) => {
                        const motivo = motivoNoBorrable(rol);
                        return (
                          <tr key={rol.id} aria-selected={rol.id === rolSeleccionado}>
                            <th scope="row">
                              {nombreDeRol(rol)}{' '}
                              {rol.isSystem ? (
                                <span className="ad-badge ad-badge-warn">
                                  {t('admin.roles.lista.sistema')}
                                </span>
                              ) : null}
                            </th>
                            <td>
                              <code>{rol.key}</code>
                            </td>
                            <td>{rol.usuarios}</td>
                            <td>
                              <div className="ad-toolbar">
                                <button
                                  type="button"
                                  className="ad-btn"
                                  onClick={() => seleccionarRol(rol)}
                                >
                                  {t('admin.roles.lista.verPermisos')}
                                </button>
                                <button
                                  type="button"
                                  className="ad-btn ad-btn-ghost"
                                  disabled={!puedeEditar || ocupado}
                                  onClick={() => abrirEditarRol(rol)}
                                >
                                  {t('admin.roles.lista.editar')}
                                </button>
                                {/* El botón se deja visible pero inhabilitado y con
                                    el motivo al lado: ocultarlo dejaría al usuario
                                    sin saber por qué no puede borrar. */}
                                <button
                                  type="button"
                                  className="ad-btn ad-btn-danger"
                                  disabled={!puedeEditar || ocupado || motivo !== null}
                                  title={motivo ?? undefined}
                                  onClick={() =>
                                    setConfirmacion({
                                      tipo: 'rol',
                                      id: rol.id,
                                      etiqueta: nombreDeRol(rol)
                                    })
                                  }
                                >
                                  {t('admin.roles.lista.borrar')}
                                </button>
                              </div>
                              {motivo ? <p className="ad-note">{motivo}</p> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="ad-card">
              <div className="ad-card-head">
                <h3>
                  {rolActual
                    ? t('admin.roles.matriz.tituloCon', { nombre: nombreDeRol(rolActual) })
                    : t('admin.roles.matriz.titulo')}
                </h3>
                {sucio ? (
                  <span className="ad-badge ad-badge-warn">{t('admin.roles.matriz.sinGuardar')}</span>
                ) : null}
              </div>
              <div className="ad-card-body">
                {!rolActual ? (
                  <p className="ad-empty">{t('admin.roles.matriz.sinSeleccion')}</p>
                ) : secciones.length === 0 ? (
                  <p className="ad-empty">{t('admin.roles.matriz.sinSecciones')}</p>
                ) : (
                  <>
                    {esSuperadmin ? (
                      <p className="ad-note">{t('admin.roles.matriz.notaSuperadmin')}</p>
                    ) : null}
                    {!puedeEditar && !esSuperadmin ? (
                      <p className="ad-note">{t('admin.roles.estado.soloLectura')}</p>
                    ) : null}

                    <table className="ad-matrix">
                      <caption>
                        {t('admin.roles.matriz.tituloCon', { nombre: nombreDeRol(rolActual) })}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('admin.roles.matriz.colSeccion')}</th>
                          <th scope="col">{t('admin.roles.matriz.colNivel')}</th>
                        </tr>
                      </thead>
                      {grupos.map((grupo) => (
                        <tbody key={grupo.clave}>
                          <tr>
                            <th scope="rowgroup" colSpan={2}>
                              {grupo.rotulo}
                            </th>
                          </tr>
                          {grupo.secciones.map((seccion) => {
                            const nombre = nombreDeSeccion(seccion);
                            const nivelActual = borrador[seccion.id] ?? 'none';
                            return (
                              <tr key={seccion.id}>
                                <th scope="row">{nombre}</th>
                                <td>
                                  {/*
                                    Los tres radios van en una sola celda porque un
                                    role="radiogroup" repartido entre varias celdas
                                    rompería la semántica de tabla (el lector de
                                    pantalla dejaría de anunciar filas y columnas).
                                  */}
                                  <div
                                    role="radiogroup"
                                    aria-label={t('admin.roles.matriz.grupoAria', { seccion: nombre })}
                                  >
                                    {NIVELES.map((nivel) => {
                                      const idRadio = `perm-${rolActual.id}-${seccion.id}-${nivel}`;
                                      return (
                                        <span key={nivel} className="ad-field">
                                          <input
                                            type="radio"
                                            id={idRadio}
                                            name={`perm-${rolActual.id}-${seccion.id}`}
                                            value={nivel}
                                            checked={nivelActual === nivel}
                                            disabled={!matrizEditable || ocupado}
                                            onChange={() => cambiarNivel(seccion.id, nivel)}
                                          />
                                          <label htmlFor={idRadio}>{etiquetaNivel[nivel]}</label>
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      ))}
                    </table>

                    <div className="ad-toolbar">
                      <button
                        type="button"
                        className="ad-btn ad-btn-primary"
                        disabled={!matrizEditable || !sucio || ocupado}
                        onClick={() => void guardarMatriz()}
                      >
                        {ocupado ? t('admin.roles.estado.guardando') : t('admin.roles.matriz.guardar')}
                      </button>
                      <button
                        type="button"
                        className="ad-btn ad-btn-ghost"
                        disabled={!sucio || ocupado}
                        onClick={descartarMatriz}
                      >
                        {t('admin.roles.matriz.descartar')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div id="panel-usuarios" role="tabpanel" aria-labelledby="tab-usuarios">
          {formUsuario ? (
            <div className="ad-card">
              <div className="ad-card-head">
                <h3>
                  {formUsuario.modo === 'crear'
                    ? t('admin.roles.usuario.tituloCrear')
                    : t('admin.roles.usuario.tituloEditar')}
                </h3>
              </div>
              <div className="ad-card-body">
                <div className="ad-grid ad-grid-2">
                  <div className="ad-field">
                    <label htmlFor="usr-email">{t('admin.roles.usuario.correo')}</label>
                    <input
                      id="usr-email"
                      className="ad-input"
                      type="email"
                      value={formUsuario.email}
                      // El servidor no acepta cambiar el correo en PATCH, así que
                      // en edición se muestra como dato, no como campo editable.
                      disabled={formUsuario.modo === 'editar'}
                      aria-describedby="usr-email-ayuda"
                      onChange={(e) => setFormUsuario({ ...formUsuario, email: e.target.value })}
                    />
                    {formUsuario.modo === 'editar' ? (
                      <p id="usr-email-ayuda" className="ad-note">
                        {t('admin.roles.usuario.correoFijo')}
                      </p>
                    ) : null}
                  </div>
                  <div className="ad-field">
                    <label htmlFor="usr-nombre">{t('admin.roles.usuario.nombre')}</label>
                    <input
                      id="usr-nombre"
                      className="ad-input"
                      type="text"
                      value={formUsuario.fullName}
                      onChange={(e) => setFormUsuario({ ...formUsuario, fullName: e.target.value })}
                    />
                  </div>
                  <div className="ad-field">
                    <label htmlFor="usr-password">
                      {formUsuario.modo === 'crear'
                        ? t('admin.roles.usuario.contrasena')
                        : t('admin.roles.usuario.contrasenaNueva')}
                    </label>
                    <input
                      id="usr-password"
                      className="ad-input"
                      type="password"
                      autoComplete="new-password"
                      value={formUsuario.password}
                      aria-describedby="usr-password-ayuda"
                      onChange={(e) => setFormUsuario({ ...formUsuario, password: e.target.value })}
                    />
                    <p id="usr-password-ayuda" className="ad-note">
                      {formUsuario.modo === 'crear'
                        ? t('admin.roles.usuario.contrasenaAyuda', { min: CONTRASENA_MIN })
                        : t('admin.roles.usuario.contrasenaOpcional', { min: CONTRASENA_MIN })}
                    </p>
                  </div>
                  <div className="ad-field">
                    <label htmlFor="usr-rol">{t('admin.roles.usuario.rol')}</label>
                    <select
                      id="usr-rol"
                      className="ad-select"
                      value={formUsuario.roleId}
                      onChange={(e) => setFormUsuario({ ...formUsuario, roleId: e.target.value })}
                    >
                      <option value="">{t('admin.roles.usuario.rolVacio')}</option>
                      {roles.map((rol) => (
                        <option key={rol.id} value={rol.id}>
                          {nombreDeRol(rol)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ad-field">
                    <label htmlFor="usr-idioma">{t('admin.roles.usuario.idioma')}</label>
                    <select
                      id="usr-idioma"
                      className="ad-select"
                      value={formUsuario.idioma}
                      onChange={(e) =>
                        setFormUsuario({ ...formUsuario, idioma: e.target.value as 'es' | 'en' })
                      }
                    >
                      <option value="es">{t('admin.roles.usuario.idiomaEs')}</option>
                      <option value="en">{t('admin.roles.usuario.idiomaEn')}</option>
                    </select>
                  </div>
                  <div className="ad-field">
                    <label htmlFor="usr-activo">{t('admin.roles.usuario.activo')}</label>
                    <input
                      id="usr-activo"
                      type="checkbox"
                      checked={formUsuario.isActive}
                      onChange={(e) => setFormUsuario({ ...formUsuario, isActive: e.target.checked })}
                    />
                  </div>
                </div>
                <div className="ad-toolbar">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary"
                    disabled={ocupado}
                    onClick={() => void guardarUsuario()}
                  >
                    {ocupado ? t('admin.roles.estado.guardando') : t('admin.roles.usuario.guardar')}
                  </button>
                  <button
                    type="button"
                    className="ad-btn ad-btn-ghost"
                    onClick={() => setFormUsuario(null)}
                  >
                    {t('admin.roles.usuario.cancelar')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="ad-card">
            <div className="ad-card-head">
              <h3>{t('admin.roles.usuarios.titulo')}</h3>
              <span className="ad-badge">
                {t('admin.roles.usuarios.total', { count: usuarios.length })}
              </span>
            </div>
            <div className="ad-card-body">
              <div className="ad-toolbar">
                <button
                  type="button"
                  className="ad-btn ad-btn-primary"
                  // Sin roles no hay `roleId` que mandar y el servidor exige uno.
                  disabled={!puedeEditar || ocupado || roles.length === 0}
                  title={roles.length === 0 ? t('admin.roles.usuarios.necesitaRol') : undefined}
                  onClick={abrirCrearUsuario}
                >
                  {t('admin.roles.usuarios.nuevo')}
                </button>
              </div>

              {roles.length === 0 ? (
                <p className="ad-note">{t('admin.roles.usuarios.necesitaRol')}</p>
              ) : null}

              {usuarios.length === 0 ? (
                <p className="ad-empty">{t('admin.roles.usuarios.vacio')}</p>
              ) : (
                <table className="ad-table">
                  <caption>{t('admin.roles.usuarios.titulo')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.roles.usuarios.colNombre')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colCorreo')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colRol')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colIdioma')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colEstado')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colUltimoAcceso')}</th>
                      <th scope="col">{t('admin.roles.usuarios.colAcciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((usuario) => {
                      const nombreRol =
                        (locale === 'en' ? usuario.roleNameEn : usuario.roleNameEs) ??
                        usuario.roleKey ??
                        t('admin.roles.usuarios.sinRol');
                      return (
                        <tr key={usuario.id}>
                          <th scope="row">{usuario.fullName}</th>
                          <td>{usuario.email}</td>
                          <td>{nombreRol}</td>
                          <td>
                            {usuario.locale === 'en'
                              ? t('admin.roles.usuario.idiomaEn')
                              : t('admin.roles.usuario.idiomaEs')}
                          </td>
                          <td>
                            <span
                              className={usuario.isActive ? 'ad-badge ad-badge-ok' : 'ad-badge ad-badge-off'}
                            >
                              {usuario.isActive
                                ? t('admin.roles.usuarios.activo')
                                : t('admin.roles.usuarios.inactivo')}
                            </span>
                          </td>
                          <td>{fecha(usuario.lastLoginAt)}</td>
                          <td>
                            <div className="ad-toolbar">
                              <button
                                type="button"
                                className="ad-btn ad-btn-ghost"
                                disabled={!puedeEditar || ocupado}
                                onClick={() => abrirEditarUsuario(usuario)}
                              >
                                {t('admin.roles.usuarios.editar')}
                              </button>
                              <button
                                type="button"
                                className="ad-btn"
                                disabled={!puedeEditar || ocupado}
                                onClick={() => void alternarActivo(usuario)}
                              >
                                {usuario.isActive
                                  ? t('admin.roles.usuarios.desactivar')
                                  : t('admin.roles.usuarios.activar')}
                              </button>
                              <button
                                type="button"
                                className="ad-btn ad-btn-danger"
                                disabled={!puedeEditar || ocupado}
                                onClick={() =>
                                  setConfirmacion({
                                    tipo: 'usuario',
                                    id: usuario.id,
                                    etiqueta: usuario.fullName
                                  })
                                }
                              >
                                {t('admin.roles.usuarios.borrar')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default RolesView;
