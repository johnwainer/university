/**
 * Etapa I — Formulario de contacto de la web pública, bilingüe.
 *
 * Envía a `POST /api/v1/contact` a través de la API intermediadora. Incluye
 * un honeypot (`company`) que la API usa para descartar bots sin darles señal
 * de que fueron detectados.
 *
 * Traducido con el `useTranslation()` de react-i18next que ya usa el resto de
 * esta rama; las claves nuevas viven en `locales/es.json` y `locales/en.json`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PublicProgram } from '../../lib/api';

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  programId: string;
  subject: string;
  message: string;
  company: string;
};

const EMPTY_FORM: FormState = {
  fullName: '',
  email: '',
  phone: '',
  programId: '',
  subject: '',
  message: '',
  company: ''
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/**
 * Niveles de `degree_programs` en esta rama. `doctoral` y `professional` son
 * los valores reales del CHECK de la tabla, no `doctorate`.
 */
const LEVEL_KEYS: Record<string, string> = {
  certificate: 'programs.level.certificate',
  associate: 'programs.level.associate',
  bachelor: 'programs.level.bachelor',
  master: 'programs.level.master',
  doctoral: 'programs.level.doctoral',
  professional: 'programs.level.professional'
};

export function ContactSection() {
  const { t, i18n } = useTranslation();
  const locale: 'es' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'es';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [programs, setPrograms] = useState<PublicProgram[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // El catálogo se recarga al cambiar de idioma: la API resuelve el sobre al
  // locale pedido.
  useEffect(() => {
    let cancelled = false;
    api
      .publicPrograms(locale)
      .then((response) => {
        if (!cancelled) setPrograms(response.programs);
      })
      .catch(() => {
        // El selector de programa es opcional: si falla, el formulario sigue
        // siendo usable sin él.
        if (!cancelled) setPrograms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const validate = useMemo(
    () => () => {
      const errors: Partial<Record<keyof FormState, string>> = {};
      if (form.fullName.trim().length < 2) {
        errors.fullName = t('contact.validation.fullName');
      }
      if (!EMAIL_PATTERN.test(form.email.trim())) {
        errors.email = t('contact.validation.email');
      }
      if (form.message.trim().length < 10) {
        errors.message = t('contact.validation.message');
      }
      return errors;
    },
    [form.fullName, form.email, form.message, t]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setStatus('sending');
    try {
      await api.submitContact({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        programId: form.programId || null,
        subject: form.subject.trim() || null,
        message: form.message.trim(),
        locale,
        company: form.company
      });
      setStatus('sent');
      setForm(EMPTY_FORM);
    } catch (submitError) {
      const text = submitError instanceof Error ? submitError.message : '';
      setError(text.includes('429') ? t('contact.error.rateLimited') : t('contact.error.generic'));
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <section className="contact-section" aria-live="polite">
        <div className="contact-success">
          <h2>{t('contact.success.title')}</h2>
          <p>{t('contact.success.body')}</p>
          <button type="button" className="ghost-btn" onClick={() => setStatus('idle')}>
            {t('contact.success.again')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="contact-section">
      <header className="contact-header">
        <h2>{t('contact.title')}</h2>
        <p>{t('contact.subtitle')}</p>
      </header>

      <form className="contact-form" onSubmit={handleSubmit} noValidate>
        <label className="contact-field">
          <span>
            {t('contact.field.fullName')} <em>{t('common.required')}</em>
          </span>
          <input
            type="text"
            name="fullName"
            autoComplete="name"
            value={form.fullName}
            maxLength={200}
            aria-invalid={Boolean(fieldErrors.fullName)}
            onChange={(event) => update('fullName', event.target.value)}
          />
          {fieldErrors.fullName ? <small className="contact-error">{fieldErrors.fullName}</small> : null}
        </label>

        <label className="contact-field">
          <span>
            {t('contact.field.email')} <em>{t('common.required')}</em>
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={form.email}
            maxLength={200}
            aria-invalid={Boolean(fieldErrors.email)}
            onChange={(event) => update('email', event.target.value)}
          />
          {fieldErrors.email ? <small className="contact-error">{fieldErrors.email}</small> : null}
        </label>

        <label className="contact-field">
          <span>
            {t('contact.field.phone')} <em>{t('common.optional')}</em>
          </span>
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            value={form.phone}
            maxLength={40}
            onChange={(event) => update('phone', event.target.value)}
          />
        </label>

        {programs.length > 0 ? (
          <label className="contact-field">
            <span>
              {t('contact.field.program')} <em>{t('common.optional')}</em>
            </span>
            <select value={form.programId} onChange={(event) => update('programId', event.target.value)}>
              <option value="">{t('contact.field.programPlaceholder')}</option>
              {programs.map((program) => {
                const levelKey = LEVEL_KEYS[program.degreeLevel];
                return (
                  <option key={program.id} value={program.id}>
                    {program.name}
                    {levelKey ? ` · ${t(levelKey)}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}

        <label className="contact-field">
          <span>
            {t('contact.field.subject')} <em>{t('common.optional')}</em>
          </span>
          <input
            type="text"
            name="subject"
            value={form.subject}
            maxLength={200}
            onChange={(event) => update('subject', event.target.value)}
          />
        </label>

        <label className="contact-field contact-field-wide">
          <span>
            {t('contact.field.message')} <em>{t('common.required')}</em>
          </span>
          <textarea
            name="message"
            rows={6}
            value={form.message}
            maxLength={5000}
            placeholder={t('contact.field.messagePlaceholder')}
            aria-invalid={Boolean(fieldErrors.message)}
            onChange={(event) => update('message', event.target.value)}
          />
          {fieldErrors.message ? <small className="contact-error">{fieldErrors.message}</small> : null}
        </label>

        {/* Honeypot: oculto para personas, visible para bots que leen el DOM. */}
        <div className="contact-honeypot" aria-hidden="true">
          <label>
            Company
            <input
              type="text"
              name="company"
              tabIndex={-1}
              autoComplete="off"
              value={form.company}
              onChange={(event) => update('company', event.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p className="contact-error contact-error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="contact-actions">
          <button type="submit" className="primary-btn" disabled={status === 'sending'}>
            {status === 'sending' ? t('common.sending') : t('contact.submit')}
          </button>
          <small className="contact-privacy">{t('contact.privacy')}</small>
        </div>
      </form>
    </section>
  );
}

export default ContactSection;
