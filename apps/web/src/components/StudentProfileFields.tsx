import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type OpcionPerfil,
  type OpcionesPerfil,
  type PerfilEstudiantePayload,
  type PerfilEstudianteResponse
} from '../lib/api';

/**
 * Campos de perfil que pidió TFU, en dos bloques de visibilidad.
 *
 * Va en su propio componente y no dentro de PublicApp.tsx por dos razones:
 * ese archivo pasa de cuatro mil líneas, y este formulario tiene su propio
 * ciclo de carga y guardado contra `/v1/me/profile`, independiente del de
 * identidad (nombre, correo, idioma) que ya existía arriba. Mezclarlos
 * obligaría a guardar los dos a la vez, y son dos cosas distintas: cambiar el
 * correo toca Moodle; cambiar la bio no.
 *
 * LA LÍNEA DE VISIBILIDAD ES EXPLÍCITA EN LA PANTALLA. El segundo bloque lleva
 * su propio rótulo —«sólo docentes y staff»— porque un estudiante tiene
 * derecho a saber quién lee lo que escribe antes de escribirlo, y porque es lo
 * que TFU especificó.
 */

type Props = {
  token: string;
  locale: 'es' | 'en';
};

type Formulario = {
  preferredName: string;
  headline: string;
  industry: string;
  bio: string;
  countryRegion: string;
  portfolioUrl: string;
  legalName: string;
  currentRole: string;
  yearsExperience: string;
  aiFamiliarity: string;
  learningGoals: string[];
  timeZone: string;
  preferredContact: string;
  languages: string;
  languageSupport: string;
};

const VACIO: Formulario = {
  preferredName: '',
  headline: '',
  industry: '',
  bio: '',
  countryRegion: '',
  portfolioUrl: '',
  legalName: '',
  currentRole: '',
  yearsExperience: '',
  aiFamiliarity: '',
  learningGoals: [],
  timeZone: '',
  preferredContact: '',
  languages: '',
  languageSupport: ''
};

/** 2 MB, el mismo límite que aplica el servidor. Se avisa antes de subir. */
const MAX_BYTES_FOTO = 2 * 1024 * 1024;

function desdeRespuesta(data: PerfilEstudianteResponse): Formulario {
  return {
    preferredName: data.visible.preferredName ?? '',
    headline: data.visible.headline ?? '',
    industry: data.visible.industry ?? '',
    bio: data.visible.bio ?? '',
    countryRegion: data.visible.countryRegion ?? '',
    portfolioUrl: data.visible.portfolioUrl ?? '',
    legalName: data.staff.legalName ?? '',
    currentRole: data.staff.currentRole ?? '',
    yearsExperience: data.staff.yearsExperience == null ? '' : String(data.staff.yearsExperience),
    aiFamiliarity: data.staff.aiFamiliarity ?? '',
    learningGoals: data.staff.learningGoals ?? [],
    timeZone: data.staff.timeZone ?? '',
    preferredContact: data.staff.preferredContact ?? '',
    languages: data.staff.languages ?? '',
    languageSupport: data.staff.languageSupport ?? ''
  };
}

export function StudentProfileFields({ token, locale }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Formulario>(VACIO);
  const [opciones, setOpciones] = useState<OpcionesPerfil | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement | null>(null);

  const etiqueta = useCallback(
    (opcion: OpcionPerfil) => (locale === 'en' ? opcion.labelEn : opcion.labelEs),
    [locale]
  );

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      setCargando(true);
      try {
        const [perfil, catalogos] = await Promise.all([api.myProfile(token), api.profileOptions()]);
        if (!vivo) return;
        setForm(desdeRespuesta(perfil));
        setAvatarUrl(perfil.visible.avatarUrl);
        setOpciones(catalogos);
      } catch (reason) {
        if (vivo) setError(reason instanceof Error ? reason.message : t('profileExt.errorCargar'));
      } finally {
        if (vivo) setCargando(false);
      }
    };
    void cargar();
    return () => {
      vivo = false;
    };
  }, [token, t]);

  const onElegirFoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES_FOTO) {
      setError(t('profileExt.fotoPesada'));
      if (inputFoto.current) inputFoto.current.value = '';
      return;
    }
    const lector = new FileReader();
    lector.onload = () => setAvatarDataUrl(typeof lector.result === 'string' ? lector.result : null);
    lector.onerror = () => setError(t('profileExt.fotoIlegible'));
    lector.readAsDataURL(file);
  };

  const alternarMeta = (valor: string) => {
    setForm((actual) => ({
      ...actual,
      learningGoals: actual.learningGoals.includes(valor)
        ? actual.learningGoals.filter((v) => v !== valor)
        : [...actual.learningGoals, valor]
    }));
  };

  const onGuardar = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      // Las cadenas vacías viajan como null: así el servidor BORRA el campo en
      // vez de guardar una cadena vacía, que luego se lee como «hay dato».
      const texto = (valor: string) => (valor.trim().length === 0 ? null : valor.trim());
      const payload: PerfilEstudiantePayload = {
        preferredName: texto(form.preferredName),
        headline: texto(form.headline),
        industry: texto(form.industry),
        bio: texto(form.bio),
        countryRegion: texto(form.countryRegion),
        portfolioUrl: texto(form.portfolioUrl),
        legalName: texto(form.legalName),
        currentRole: texto(form.currentRole),
        yearsExperience: form.yearsExperience.trim() === '' ? null : Number(form.yearsExperience),
        aiFamiliarity: form.aiFamiliarity === '' ? null : form.aiFamiliarity,
        learningGoals: form.learningGoals,
        timeZone: texto(form.timeZone),
        preferredContact: form.preferredContact === '' ? null : form.preferredContact,
        languages: texto(form.languages),
        languageSupport: texto(form.languageSupport)
      };
      if (avatarDataUrl) {
        payload.avatarDataUrl = avatarDataUrl;
      }
      const resultado = await api.saveMyProfile(token, payload);
      setForm(desdeRespuesta(resultado));
      setAvatarUrl(resultado.visible.avatarUrl);
      setAvatarDataUrl(null);
      if (inputFoto.current) inputFoto.current.value = '';
      // Si el servidor no pudo subir la foto lo dice, y se muestra tal cual en
      // vez de un «guardado» a secas que haría creer que la foto quedó.
      setMensaje(resultado.avatarAviso ? `${t('profileExt.guardado')} ${resultado.avatarAviso}` : t('profileExt.guardado'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('profileExt.errorGuardar'));
    } finally {
      setGuardando(false);
    }
  };

  const vistaPreviaFoto = avatarDataUrl ?? avatarUrl;
  const iniciales = useMemo(() => {
    const base = form.preferredName || form.legalName || '';
    return base
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }, [form.preferredName, form.legalName]);

  if (cargando) {
    return <p className="profile-editor-feedback">{t('profileExt.cargando')}</p>;
  }

  return (
    <form className="profile-ext-form" onSubmit={onGuardar}>
      <fieldset className="profile-ext-bloque">
        <legend>{t('profileExt.bloqueVisible')}</legend>
        <p className="profile-ext-nota">{t('profileExt.bloqueVisibleNota')}</p>

        <div className="profile-ext-foto">
          <div className="profile-ext-avatar" aria-hidden={vistaPreviaFoto ? undefined : true}>
            {vistaPreviaFoto ? (
              <img src={vistaPreviaFoto} alt={t('profileExt.fotoAlt')} />
            ) : (
              <span>{iniciales || '—'}</span>
            )}
          </div>
          <div className="profile-ext-foto-acciones">
            <label className="profile-ext-foto-label">
              {t('profileExt.foto')}
              <input
                ref={inputFoto}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onElegirFoto}
                disabled={opciones ? !opciones.avatarUploadEnabled : false}
              />
            </label>
            <small>
              {opciones && !opciones.avatarUploadEnabled
                ? t('profileExt.fotoNoConfigurada')
                : t('profileExt.fotoAyuda')}
            </small>
          </div>
        </div>

        <label>
          {t('profileExt.preferredName')}
          <input
            value={form.preferredName}
            maxLength={120}
            onChange={(e) => setForm((a) => ({ ...a, preferredName: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.headline')}
          <input
            value={form.headline}
            maxLength={160}
            placeholder={t('profileExt.headlinePlaceholder')}
            onChange={(e) => setForm((a) => ({ ...a, headline: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.industry')}
          <input
            value={form.industry}
            maxLength={120}
            onChange={(e) => setForm((a) => ({ ...a, industry: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.bio')}
          <textarea
            value={form.bio}
            maxLength={1200}
            rows={4}
            placeholder={t('profileExt.bioPrompt')}
            onChange={(e) => setForm((a) => ({ ...a, bio: e.target.value }))}
          />
          <small>{t('profileExt.bioAyuda')}</small>
        </label>

        <label>
          {t('profileExt.countryRegion')}
          <input
            value={form.countryRegion}
            maxLength={120}
            onChange={(e) => setForm((a) => ({ ...a, countryRegion: e.target.value }))}
          />
          <small>{t('profileExt.countryRegionAyuda')}</small>
        </label>

        <label>
          {t('profileExt.portfolioUrl')}
          <input
            type="url"
            value={form.portfolioUrl}
            maxLength={300}
            placeholder="https://www.linkedin.com/in/..."
            onChange={(e) => setForm((a) => ({ ...a, portfolioUrl: e.target.value }))}
          />
        </label>
      </fieldset>

      <fieldset className="profile-ext-bloque profile-ext-bloque-staff">
        <legend>{t('profileExt.bloqueStaff')}</legend>
        <p className="profile-ext-nota">{t('profileExt.bloqueStaffNota')}</p>

        <label>
          {t('profileExt.legalName')}
          <input
            value={form.legalName}
            maxLength={160}
            onChange={(e) => setForm((a) => ({ ...a, legalName: e.target.value }))}
          />
          <small>{t('profileExt.legalNameAyuda')}</small>
        </label>

        <label>
          {t('profileExt.currentRole')}
          <input
            value={form.currentRole}
            maxLength={160}
            onChange={(e) => setForm((a) => ({ ...a, currentRole: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.yearsExperience')}
          <input
            type="number"
            min={0}
            max={70}
            value={form.yearsExperience}
            onChange={(e) => setForm((a) => ({ ...a, yearsExperience: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.aiFamiliarity')}
          <select
            value={form.aiFamiliarity}
            onChange={(e) => setForm((a) => ({ ...a, aiFamiliarity: e.target.value }))}
          >
            <option value="">{t('profileExt.sinElegir')}</option>
            {(opciones?.aiFamiliarity ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {etiqueta(o)}
              </option>
            ))}
          </select>
        </label>

        <div className="profile-ext-metas">
          <span className="profile-ext-metas-titulo">{t('profileExt.learningGoals')}</span>
          {(opciones?.learningGoals ?? []).map((o) => (
            <label key={o.value} className="profile-ext-checkbox">
              <input
                type="checkbox"
                checked={form.learningGoals.includes(o.value)}
                onChange={() => alternarMeta(o.value)}
              />
              {etiqueta(o)}
            </label>
          ))}
        </div>

        <label>
          {t('profileExt.timeZone')}
          <input
            value={form.timeZone}
            maxLength={80}
            placeholder="America/Bogota"
            onChange={(e) => setForm((a) => ({ ...a, timeZone: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.preferredContact')}
          <select
            value={form.preferredContact}
            onChange={(e) => setForm((a) => ({ ...a, preferredContact: e.target.value }))}
          >
            <option value="">{t('profileExt.sinElegir')}</option>
            {(opciones?.preferredContact ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {etiqueta(o)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('profileExt.languages')}
          <input
            value={form.languages}
            maxLength={160}
            onChange={(e) => setForm((a) => ({ ...a, languages: e.target.value }))}
          />
        </label>

        <label>
          {t('profileExt.languageSupport')}
          <textarea
            value={form.languageSupport}
            maxLength={400}
            rows={2}
            onChange={(e) => setForm((a) => ({ ...a, languageSupport: e.target.value }))}
          />
        </label>
      </fieldset>

      <div className="profile-editor-actions">
        <button type="submit" className="go-course-btn" disabled={guardando}>
          {guardando ? t('profileExt.guardando') : t('profileExt.guardar')}
        </button>
      </div>
      {mensaje ? <p className="profile-editor-feedback success">{mensaje}</p> : null}
      {error ? <p className="profile-editor-feedback error">{error}</p> : null}
    </form>
  );
}
