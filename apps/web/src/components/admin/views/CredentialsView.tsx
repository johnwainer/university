import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

// This view talks to the credentials module endpoints directly (the shared
// `api.ts` helper is owned by the orchestrator and not edited here).
async function apiFetch<T>(
  path: string,
  token: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
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
      // ignore body parse failures
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

interface CompetencyRecord {
  id: string;
  name: string;
  code: string;
  description: string | null;
  moodle_course_id: number | null;
  degree_program_id: string | null;
  course_name: string | null;
  degree_program_name: string | null;
  created_at: string;
}

interface BadgeRecord {
  id: string;
  name: string;
  description: string | null;
  criteria: string | null;
  image_url: string | null;
  competency_id: string | null;
  competency_name: string | null;
  created_at: string;
}

interface CertificateRecord {
  id: string;
  student_user_id: string | null;
  title: string;
  kind: string;
  moodle_course_id: number | null;
  degree_program_id: string | null;
  serial: string;
  verification_code: string;
  issued_at: string;
  student_name: string | null;
  student_email: string | null;
  degree_program_name: string | null;
}

type Tab = 'competencies' | 'badges' | 'certificates';

export function CredentialsView({
  sessionToken,
  setError,
  setInfo
}: {
  sessionToken: string | null;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('competencies');

  const [competencies, setCompetencies] = useState<CompetencyRecord[]>([]);
  const [badges, setBadges] = useState<BadgeRecord[]>([]);
  const [certificates, setCertificates] = useState<CertificateRecord[]>([]);

  const [savingCompetency, setSavingCompetency] = useState(false);
  const [savingBadge, setSavingBadge] = useState(false);
  const [savingCertificate, setSavingCertificate] = useState(false);

  const [competencyForm, setCompetencyForm] = useState({
    name: '',
    code: '',
    description: '',
    moodleCourseId: '',
    degreeProgramId: ''
  });

  const [badgeForm, setBadgeForm] = useState({
    name: '',
    description: '',
    criteria: '',
    imageUrl: '',
    competencyId: ''
  });

  const [certificateForm, setCertificateForm] = useState({
    studentUserId: '',
    title: '',
    kind: 'course' as 'course' | 'program' | 'badge',
    moodleCourseId: '',
    degreeProgramId: ''
  });

  const loadCompetencies = async (token: string) => {
    try {
      setCompetencies(await apiFetch<CompetencyRecord[]>('/admin/competencies', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorCargarCompetencias'));
    }
  };

  const loadBadges = async (token: string) => {
    try {
      setBadges(await apiFetch<BadgeRecord[]>('/admin/badges', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorCargarBadges'));
    }
  };

  const loadCertificates = async (token: string) => {
    try {
      setCertificates(await apiFetch<CertificateRecord[]>('/admin/certificates', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorCargarCertificados'));
    }
  };

  useEffect(() => {
    if (sessionToken) {
      void loadCompetencies(sessionToken);
      void loadBadges(sessionToken);
      void loadCertificates(sessionToken);
    }
  }, [sessionToken]);

  const onCreateCompetency = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingCompetency(true);
    setError(null);
    setInfo(null);
    try {
      await apiFetch('/admin/competencies', sessionToken, {
        method: 'POST',
        body: {
          name: competencyForm.name,
          code: competencyForm.code,
          description: competencyForm.description || undefined,
          moodleCourseId: competencyForm.moodleCourseId ? Number(competencyForm.moodleCourseId) : null,
          degreeProgramId: competencyForm.degreeProgramId || null
        }
      });
      setInfo(t('admin.credentials.competenciaCreada'));
      setCompetencyForm({ name: '', code: '', description: '', moodleCourseId: '', degreeProgramId: '' });
      await loadCompetencies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorCrearCompetencia'));
    } finally {
      setSavingCompetency(false);
    }
  };

  const onDeleteCompetency = async (id: string) => {
    if (!sessionToken || !confirm(t('admin.credentials.confirmEliminarCompetencia'))) return;
    try {
      await apiFetch(`/admin/competencies/${id}`, sessionToken, { method: 'DELETE' });
      setInfo(t('admin.credentials.competenciaEliminada'));
      await loadCompetencies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorEliminarCompetencia'));
    }
  };

  const onCreateBadge = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingBadge(true);
    setError(null);
    setInfo(null);
    try {
      await apiFetch('/admin/badges', sessionToken, {
        method: 'POST',
        body: {
          name: badgeForm.name,
          description: badgeForm.description || undefined,
          criteria: badgeForm.criteria || undefined,
          imageUrl: badgeForm.imageUrl || null,
          competencyId: badgeForm.competencyId || null
        }
      });
      setInfo(t('admin.credentials.badgeCreado'));
      setBadgeForm({ name: '', description: '', criteria: '', imageUrl: '', competencyId: '' });
      await loadBadges(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorCrearBadge'));
    } finally {
      setSavingBadge(false);
    }
  };

  const onDeleteBadge = async (id: string) => {
    if (!sessionToken || !confirm(t('admin.credentials.confirmEliminarBadge'))) return;
    try {
      await apiFetch(`/admin/badges/${id}`, sessionToken, { method: 'DELETE' });
      setInfo(t('admin.credentials.badgeEliminado'));
      await loadBadges(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorEliminarBadge'));
    }
  };

  const onIssueCertificate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingCertificate(true);
    setError(null);
    setInfo(null);
    try {
      await apiFetch('/admin/certificates/issue', sessionToken, {
        method: 'POST',
        body: {
          studentUserId: certificateForm.studentUserId,
          title: certificateForm.title,
          kind: certificateForm.kind,
          moodleCourseId: certificateForm.moodleCourseId ? Number(certificateForm.moodleCourseId) : null,
          degreeProgramId: certificateForm.degreeProgramId || null
        }
      });
      setInfo(t('admin.credentials.certificadoEmitido'));
      setCertificateForm({ studentUserId: '', title: '', kind: 'course', moodleCourseId: '', degreeProgramId: '' });
      await loadCertificates(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.credentials.errorEmitirCertificado'));
    } finally {
      setSavingCertificate(false);
    }
  };

  const verifyBaseUrl = `${API_URL}/v1/verify/`;

  return (
    <section className="grid-1">
      <article className="card">
        <div className="inline-actions" style={{ gap: '8px', marginBottom: '8px' }}>
          <button className={tab === 'competencies' ? '' : 'ghost'} onClick={() => setTab('competencies')}>
            {t('admin.credentials.tabCompetencias')}
          </button>
          <button className={tab === 'badges' ? '' : 'ghost'} onClick={() => setTab('badges')}>
            {t('admin.credentials.tabBadges')}
          </button>
          <button className={tab === 'certificates' ? '' : 'ghost'} onClick={() => setTab('certificates')}>
            {t('admin.credentials.tabCertificados')}
          </button>
        </div>
      </article>

      {tab === 'competencies' && (
        <section className="grid-2">
          <article className="card">
            <h2>{t('admin.credentials.crearCompetenciaTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateCompetency}>
              <label>{t('admin.credentials.campoNombre')}</label>
              <input
                value={competencyForm.name}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, name: e.target.value }))}
                placeholder={t('admin.credentials.placeholderNombreCompetencia')}
                required
              />
              <label>{t('admin.credentials.campoCodigo')}</label>
              <input
                value={competencyForm.code}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, code: e.target.value }))}
                placeholder={t('admin.credentials.placeholderCodigo')}
                required
              />
              <label>{t('admin.credentials.campoDescripcion')}</label>
              <input
                value={competencyForm.description}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, description: e.target.value }))}
                placeholder={t('admin.credentials.placeholderDescripcionCompetencia')}
              />
              <label>{t('admin.credentials.campoIdCursoMoodle')}</label>
              <input
                type="number"
                value={competencyForm.moodleCourseId}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder={t('admin.credentials.placeholderIdCursoMoodle')}
              />
              <label>{t('admin.credentials.campoIdPrograma')}</label>
              <input
                value={competencyForm.degreeProgramId}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder={t('admin.credentials.placeholderIdPrograma')}
              />
              <button type="submit" disabled={savingCompetency}>
                {savingCompetency ? t('admin.credentials.guardando') : t('admin.credentials.crearCompetencia')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.credentials.competenciasTitulo', { total: competencies.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.credentials.colNombre')}</th>
                  <th>{t('admin.credentials.colCodigo')}</th>
                  <th>{t('admin.credentials.colCurso')}</th>
                  <th>{t('admin.credentials.colPrograma')}</th>
                  <th>{t('admin.credentials.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {competencies.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{t('admin.credentials.sinCompetencias')}</td>
                  </tr>
                ) : (
                  competencies.map((comp) => (
                    <tr key={comp.id}>
                      <td>{comp.name}</td>
                      <td>{comp.code}</td>
                      <td>{comp.course_name ?? (comp.moodle_course_id ?? '-')}</td>
                      <td>{comp.degree_program_name ?? '-'}</td>
                      <td>
                        <button className="ghost danger" onClick={() => void onDeleteCompetency(comp.id)}>
                          {t('admin.credentials.borrar')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {tab === 'badges' && (
        <section className="grid-2">
          <article className="card">
            <h2>{t('admin.credentials.crearBadgeTitulo')}</h2>
            <form className="login-form" onSubmit={onCreateBadge}>
              <label>{t('admin.credentials.campoNombre')}</label>
              <input
                value={badgeForm.name}
                onChange={(e) => setBadgeForm((c) => ({ ...c, name: e.target.value }))}
                placeholder={t('admin.credentials.placeholderNombreBadge')}
                required
              />
              <label>{t('admin.credentials.campoDescripcion')}</label>
              <input
                value={badgeForm.description}
                onChange={(e) => setBadgeForm((c) => ({ ...c, description: e.target.value }))}
                placeholder={t('admin.credentials.placeholderDescripcionBadge')}
              />
              <label>{t('admin.credentials.campoCriterios')}</label>
              <input
                value={badgeForm.criteria}
                onChange={(e) => setBadgeForm((c) => ({ ...c, criteria: e.target.value }))}
                placeholder={t('admin.credentials.placeholderCriterios')}
              />
              <label>{t('admin.credentials.campoUrlImagen')}</label>
              <input
                value={badgeForm.imageUrl}
                onChange={(e) => setBadgeForm((c) => ({ ...c, imageUrl: e.target.value }))}
                placeholder="https://..."
              />
              <label>{t('admin.credentials.campoCompetenciaAsociada')}</label>
              <select
                value={badgeForm.competencyId}
                onChange={(e) => setBadgeForm((c) => ({ ...c, competencyId: e.target.value }))}
              >
                <option value="">{t('admin.credentials.optionNinguna')}</option>
                {competencies.map((comp) => (
                  <option key={comp.id} value={comp.id}>
                    {comp.name} ({comp.code})
                  </option>
                ))}
              </select>
              <button type="submit" disabled={savingBadge}>
                {savingBadge ? t('admin.credentials.guardando') : t('admin.credentials.crearBadge')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.credentials.badgesTitulo', { total: badges.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.credentials.colNombre')}</th>
                  <th>{t('admin.credentials.colCompetencia')}</th>
                  <th>{t('admin.credentials.colCriterios')}</th>
                  <th>{t('admin.credentials.colAccion')}</th>
                </tr>
              </thead>
              <tbody>
                {badges.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{t('admin.credentials.sinBadges')}</td>
                  </tr>
                ) : (
                  badges.map((badge) => (
                    <tr key={badge.id}>
                      <td>{badge.name}</td>
                      <td>{badge.competency_name ?? '-'}</td>
                      <td>{badge.criteria ?? '-'}</td>
                      <td>
                        <button className="ghost danger" onClick={() => void onDeleteBadge(badge.id)}>
                          {t('admin.credentials.borrar')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {tab === 'certificates' && (
        <section className="grid-2">
          <article className="card">
            <h2>{t('admin.credentials.emitirCertificadoTitulo')}</h2>
            <form className="login-form" onSubmit={onIssueCertificate}>
              <label>{t('admin.credentials.campoIdEstudiante')}</label>
              <input
                value={certificateForm.studentUserId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, studentUserId: e.target.value }))}
                placeholder={t('admin.credentials.placeholderIdEstudiante')}
                required
              />
              <label>{t('admin.credentials.campoTitulo')}</label>
              <input
                value={certificateForm.title}
                onChange={(e) => setCertificateForm((c) => ({ ...c, title: e.target.value }))}
                placeholder={t('admin.credentials.placeholderTituloCertificado')}
                required
              />
              <label>{t('admin.credentials.campoTipo')}</label>
              <select
                value={certificateForm.kind}
                onChange={(e) =>
                  setCertificateForm((c) => ({ ...c, kind: e.target.value as 'course' | 'program' | 'badge' }))
                }
              >
                <option value="course">{t('admin.credentials.tipoCurso')}</option>
                <option value="program">{t('admin.credentials.tipoPrograma')}</option>
                <option value="badge">{t('admin.credentials.tipoBadge')}</option>
              </select>
              <label>{t('admin.credentials.campoIdCursoMoodle')}</label>
              <input
                type="number"
                value={certificateForm.moodleCourseId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder={t('admin.credentials.placeholderIdCursoMoodle')}
              />
              <label>{t('admin.credentials.campoIdPrograma')}</label>
              <input
                value={certificateForm.degreeProgramId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder={t('admin.credentials.placeholderIdPrograma')}
              />
              <button type="submit" disabled={savingCertificate}>
                {savingCertificate ? t('admin.credentials.emitiendo') : t('admin.credentials.emitirCertificado')}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>{t('admin.credentials.certificadosTitulo', { total: certificates.length })}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('admin.credentials.colEstudiante')}</th>
                  <th>{t('admin.credentials.colTitulo')}</th>
                  <th>{t('admin.credentials.colTipo')}</th>
                  <th>{t('admin.credentials.colSerial')}</th>
                  <th>{t('admin.credentials.colVerificacion')}</th>
                  <th>{t('admin.credentials.colEmitido')}</th>
                </tr>
              </thead>
              <tbody>
                {certificates.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('admin.credentials.sinCertificados')}</td>
                  </tr>
                ) : (
                  certificates.map((cert) => (
                    <tr key={cert.id}>
                      <td>{cert.student_name ?? cert.student_user_id ?? '-'}</td>
                      <td>{cert.title}</td>
                      <td>{cert.kind}</td>
                      <td>
                        <code>{cert.serial}</code>
                      </td>
                      <td>
                        <a href={`${verifyBaseUrl}${cert.verification_code}`} target="_blank" rel="noreferrer">
                          {cert.verification_code}
                        </a>
                      </td>
                      <td>{new Date(cert.issued_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </section>
      )}
    </section>
  );
}
