/**
 * Postulación pública, bilingüe.
 *
 * El flujo de admisiones tenía tabla y gestión por etapas en el panel, pero no
 * había forma de postularse desde fuera: la única entrada era que alguien
 * tecleara el registro a mano. Esto cierra el circuito.
 *
 * Dos piezas en una: el formulario y la consulta de estado por código. Van
 * juntas porque es la misma conversación —postulo, me dan un código, vuelvo a
 * mirar cómo va— y separarlas en dos páginas obliga al postulante a buscar.
 *
 * Accesibilidad: cada campo lleva su `<label>` envolvente, los errores se
 * anuncian con `aria-describedby` y el resultado vive en una región `role="status"`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PublicProgram } from '../../lib/api';

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  programId: string;
  background: string;
  /** Honeypot: invisible para una persona, irresistible para un bot. */
  website: string;
};

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  programId: '',
  background: '',
  website: ''
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

type Submitted = { trackingCode: string; program: string };

export function AdmissionsForm() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en' : 'es';

  const [programs, setPrograms] = useState<PublicProgram[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Consulta de estado
  const [lookupCode, setLookupCode] = useState('');
  const [lookup, setLookup] = useState<{ stage: string; program: string | null; updatedAt: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .publicPrograms(locale)
      .then((response) => {
        if (!cancelled) setPrograms(response.programs ?? []);
      })
      .catch(() => {
        if (!cancelled) setPrograms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicProgram[]>();
    for (const program of programs) {
      const key = program.degreeLevel ?? 'other';
      map.set(key, [...(map.get(key) ?? []), program]);
    }
    return [...map.entries()];
  }, [programs]);

  const set = (field: keyof FormState) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.fullName.trim().length < 3) next.fullName = t('admissions.errorName');
    if (!EMAIL_PATTERN.test(form.email.trim())) next.email = t('admissions.errorEmail');
    if (!form.programId) next.programId = t('admissions.errorProgram');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFailure(null);
    if (!validate()) return;
    setSending(true);
    try {
      const result = await api.applyToProgram({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        programId: form.programId,
        background: form.background.trim() || undefined,
        locale,
        website: form.website
      });
      setSubmitted({ trackingCode: result.trackingCode, program: result.program });
      setForm(EMPTY);
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : t('admissions.errorGeneric'));
    } finally {
      setSending(false);
    }
  };

  const doLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    setLookupError(null);
    setLookup(null);
    if (!lookupCode.trim()) return;
    setLookingUp(true);
    try {
      setLookup(await api.admissionStatus(lookupCode.trim()));
    } catch {
      setLookupError(t('admissions.lookupNotFound'));
    } finally {
      setLookingUp(false);
    }
  };

  if (submitted) {
    return (
      <div className="admissions-result" role="status">
        <h3>{t('admissions.successTitle')}</h3>
        <p>{t('admissions.successBody', { program: submitted.program })}</p>
        <p className="admissions-code-label">{t('admissions.yourCode')}</p>
        <p className="admissions-code">{submitted.trackingCode}</p>
        <p className="admissions-code-help">{t('admissions.codeHelp')}</p>
        <button type="button" className="ghost-btn" onClick={() => setSubmitted(null)}>
          {t('admissions.anotherApplication')}
        </button>
      </div>
    );
  }

  return (
    <div className="admissions-layout">
      <form className="admissions-form" onSubmit={submit} noValidate>
        <h3>{t('admissions.formTitle')}</h3>
        <p className="admissions-form-lead">{t('admissions.formLead')}</p>

        <label className="admissions-field">
          <span>
            {t('admissions.fullName')} <em aria-hidden="true">*</em>
          </span>
          <input
            value={form.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
            autoComplete="name"
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? 'adm-name-error' : undefined}
            required
          />
          {errors.fullName ? (
            <small id="adm-name-error" className="admissions-error">
              {errors.fullName}
            </small>
          ) : null}
        </label>

        <label className="admissions-field">
          <span>
            {t('admissions.email')} <em aria-hidden="true">*</em>
          </span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
            autoComplete="email"
            inputMode="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'adm-email-error' : undefined}
            required
          />
          {errors.email ? (
            <small id="adm-email-error" className="admissions-error">
              {errors.email}
            </small>
          ) : null}
        </label>

        <label className="admissions-field">
          <span>{t('admissions.phone')}</span>
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => set('phone')(event.target.value)}
            autoComplete="tel"
          />
        </label>

        <label className="admissions-field">
          <span>
            {t('admissions.program')} <em aria-hidden="true">*</em>
          </span>
          <select
            value={form.programId}
            onChange={(event) => set('programId')(event.target.value)}
            aria-invalid={Boolean(errors.programId)}
            aria-describedby={errors.programId ? 'adm-program-error' : undefined}
            required
          >
            <option value="">{t('admissions.programPlaceholder')}</option>
            {grouped.map(([level, items]) => (
              <optgroup key={level} label={t(`admissions.level.${level}`, { defaultValue: level })}>
                {items.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.programId ? (
            <small id="adm-program-error" className="admissions-error">
              {errors.programId}
            </small>
          ) : null}
        </label>

        <label className="admissions-field">
          <span>{t('admissions.background')}</span>
          <textarea
            rows={4}
            value={form.background}
            onChange={(event) => set('background')(event.target.value)}
            maxLength={2000}
          />
          <small className="admissions-hint">{t('admissions.backgroundHint')}</small>
        </label>

        {/* Honeypot. Fuera del viewport por posición y no con display:none,
            que algunos bots detectan; aria-hidden y tabIndex lo sacan del
            recorrido de teclado y del lector de pantalla. */}
        <div aria-hidden="true" className="admissions-honeypot">
          <label>
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(event) => set('website')(event.target.value)}
            />
          </label>
        </div>

        {failure ? (
          <p className="admissions-error" role="alert">
            {failure}
          </p>
        ) : null}

        <button type="submit" className="go-course-btn" disabled={sending}>
          {sending ? t('admissions.sending') : t('admissions.submit')}
        </button>
        <p className="admissions-privacy">{t('admissions.privacy')}</p>
      </form>

      <aside className="admissions-lookup">
        <h3>{t('admissions.lookupTitle')}</h3>
        <p>{t('admissions.lookupLead')}</p>
        <form onSubmit={doLookup}>
          <label className="admissions-field">
            <span>{t('admissions.lookupCode')}</span>
            <input
              value={lookupCode}
              onChange={(event) => setLookupCode(event.target.value)}
              placeholder="TFU-ABC-DEF-GHI"
              aria-label={t('admissions.lookupCode')}
            />
          </label>
          <button type="submit" className="ghost-btn" disabled={lookingUp}>
            {lookingUp ? t('admissions.lookingUp') : t('admissions.lookupSubmit')}
          </button>
        </form>
        <div role="status">
          {lookup ? (
            <div className="admissions-lookup-result">
              <p className="admissions-stage">{t(`admissions.stage.${lookup.stage}`, { defaultValue: lookup.stage })}</p>
              {lookup.program ? <p>{lookup.program}</p> : null}
              <p className="admissions-hint">
                {t('admissions.lastUpdate', {
                  date: new Date(lookup.updatedAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })
                })}
              </p>
            </div>
          ) : null}
          {lookupError ? <p className="admissions-error">{lookupError}</p> : null}
        </div>
      </aside>
    </div>
  );
}
