import React, { useState, useEffect } from 'react';

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
      setError(reason instanceof Error ? reason.message : 'Error cargando competencias');
    }
  };

  const loadBadges = async (token: string) => {
    try {
      setBadges(await apiFetch<BadgeRecord[]>('/admin/badges', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando badges');
    }
  };

  const loadCertificates = async (token: string) => {
    try {
      setCertificates(await apiFetch<CertificateRecord[]>('/admin/certificates', token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error cargando certificados');
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
      setInfo('Competencia creada.');
      setCompetencyForm({ name: '', code: '', description: '', moodleCourseId: '', degreeProgramId: '' });
      await loadCompetencies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear competencia');
    } finally {
      setSavingCompetency(false);
    }
  };

  const onDeleteCompetency = async (id: string) => {
    if (!sessionToken || !confirm('¿Eliminar esta competencia?')) return;
    try {
      await apiFetch(`/admin/competencies/${id}`, sessionToken, { method: 'DELETE' });
      setInfo('Competencia eliminada.');
      await loadCompetencies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar competencia');
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
      setInfo('Badge creado.');
      setBadgeForm({ name: '', description: '', criteria: '', imageUrl: '', competencyId: '' });
      await loadBadges(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear badge');
    } finally {
      setSavingBadge(false);
    }
  };

  const onDeleteBadge = async (id: string) => {
    if (!sessionToken || !confirm('¿Eliminar este badge?')) return;
    try {
      await apiFetch(`/admin/badges/${id}`, sessionToken, { method: 'DELETE' });
      setInfo('Badge eliminado.');
      await loadBadges(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar badge');
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
      setInfo('Certificado emitido.');
      setCertificateForm({ studentUserId: '', title: '', kind: 'course', moodleCourseId: '', degreeProgramId: '' });
      await loadCertificates(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo emitir certificado');
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
            Competencias
          </button>
          <button className={tab === 'badges' ? '' : 'ghost'} onClick={() => setTab('badges')}>
            Badges
          </button>
          <button className={tab === 'certificates' ? '' : 'ghost'} onClick={() => setTab('certificates')}>
            Certificados
          </button>
        </div>
      </article>

      {tab === 'competencies' && (
        <section className="grid-2">
          <article className="card">
            <h2>Crear competencia</h2>
            <form className="login-form" onSubmit={onCreateCompetency}>
              <label>Nombre</label>
              <input
                value={competencyForm.name}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Pensamiento crítico"
                required
              />
              <label>Código</label>
              <input
                value={competencyForm.code}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, code: e.target.value }))}
                placeholder="CBE-101"
                required
              />
              <label>Descripción</label>
              <input
                value={competencyForm.description}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, description: e.target.value }))}
                placeholder="Descripción de la competencia"
              />
              <label>ID Curso Moodle (opcional)</label>
              <input
                type="number"
                value={competencyForm.moodleCourseId}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder="123"
              />
              <label>ID Programa (opcional)</label>
              <input
                value={competencyForm.degreeProgramId}
                onChange={(e) => setCompetencyForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder="uuid del degree_program"
              />
              <button type="submit" disabled={savingCompetency}>
                {savingCompetency ? 'Guardando...' : 'Crear competencia'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Competencias ({competencies.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Código</th>
                  <th>Curso</th>
                  <th>Programa</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {competencies.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No hay competencias.</td>
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
                          Borrar
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
            <h2>Crear badge</h2>
            <form className="login-form" onSubmit={onCreateBadge}>
              <label>Nombre</label>
              <input
                value={badgeForm.name}
                onChange={(e) => setBadgeForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Líder colaborativo"
                required
              />
              <label>Descripción</label>
              <input
                value={badgeForm.description}
                onChange={(e) => setBadgeForm((c) => ({ ...c, description: e.target.value }))}
                placeholder="Descripción del badge"
              />
              <label>Criterios</label>
              <input
                value={badgeForm.criteria}
                onChange={(e) => setBadgeForm((c) => ({ ...c, criteria: e.target.value }))}
                placeholder="Criterios para obtenerlo"
              />
              <label>URL de imagen (opcional)</label>
              <input
                value={badgeForm.imageUrl}
                onChange={(e) => setBadgeForm((c) => ({ ...c, imageUrl: e.target.value }))}
                placeholder="https://..."
              />
              <label>Competencia asociada (opcional)</label>
              <select
                value={badgeForm.competencyId}
                onChange={(e) => setBadgeForm((c) => ({ ...c, competencyId: e.target.value }))}
              >
                <option value="">Ninguna</option>
                {competencies.map((comp) => (
                  <option key={comp.id} value={comp.id}>
                    {comp.name} ({comp.code})
                  </option>
                ))}
              </select>
              <button type="submit" disabled={savingBadge}>
                {savingBadge ? 'Guardando...' : 'Crear badge'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Badges ({badges.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Competencia</th>
                  <th>Criterios</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {badges.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No hay badges.</td>
                  </tr>
                ) : (
                  badges.map((badge) => (
                    <tr key={badge.id}>
                      <td>{badge.name}</td>
                      <td>{badge.competency_name ?? '-'}</td>
                      <td>{badge.criteria ?? '-'}</td>
                      <td>
                        <button className="ghost danger" onClick={() => void onDeleteBadge(badge.id)}>
                          Borrar
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
            <h2>Emitir certificado</h2>
            <form className="login-form" onSubmit={onIssueCertificate}>
              <label>ID del estudiante (user_id)</label>
              <input
                value={certificateForm.studentUserId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, studentUserId: e.target.value }))}
                placeholder="user id"
                required
              />
              <label>Título</label>
              <input
                value={certificateForm.title}
                onChange={(e) => setCertificateForm((c) => ({ ...c, title: e.target.value }))}
                placeholder="Certificado de finalización"
                required
              />
              <label>Tipo</label>
              <select
                value={certificateForm.kind}
                onChange={(e) =>
                  setCertificateForm((c) => ({ ...c, kind: e.target.value as 'course' | 'program' | 'badge' }))
                }
              >
                <option value="course">Curso</option>
                <option value="program">Programa</option>
                <option value="badge">Badge</option>
              </select>
              <label>ID Curso Moodle (opcional)</label>
              <input
                type="number"
                value={certificateForm.moodleCourseId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, moodleCourseId: e.target.value }))}
                placeholder="123"
              />
              <label>ID Programa (opcional)</label>
              <input
                value={certificateForm.degreeProgramId}
                onChange={(e) => setCertificateForm((c) => ({ ...c, degreeProgramId: e.target.value }))}
                placeholder="uuid del degree_program"
              />
              <button type="submit" disabled={savingCertificate}>
                {savingCertificate ? 'Emitiendo...' : 'Emitir certificado'}
              </button>
            </form>
          </article>

          <article className="card scroll-card">
            <h2>Certificados emitidos ({certificates.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Estudiante</th>
                  <th>Título</th>
                  <th>Tipo</th>
                  <th>Serial</th>
                  <th>Verificación</th>
                  <th>Emitido</th>
                </tr>
              </thead>
              <tbody>
                {certificates.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No hay certificados emitidos.</td>
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
