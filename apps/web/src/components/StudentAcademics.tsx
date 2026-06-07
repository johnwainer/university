import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type BillingResponse,
  type CertificateRecord,
  type CompetencyRecord,
  type GpaRecord,
  type TranscriptRecord
} from '../lib/api';

type Tab = 'record' | 'billing' | 'certificates' | 'competencies';

type Props = {
  token: string;
  onGoMyCourses?: () => void;
};

function money(cents: number | string, currency = 'usd'): string {
  const value = Number(cents) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function StudentAcademics({ token, onGoMyCourses }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('record');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [transcript, setTranscript] = useState<TranscriptRecord[]>([]);
  const [gpa, setGpa] = useState<GpaRecord | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [certificates, setCertificates] = useState<CertificateRecord[]>([]);
  const [competencies, setCompetencies] = useState<CompetencyRecord[]>([]);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.publicAuth.transcript(token),
      api.publicAuth.gpa(token),
      api.publicAuth.billing(token),
      api.publicAuth.certificates(token),
      api.publicAuth.competencies(token)
    ])
      .then(([tr, gp, bl, ce, co]) => {
        if (cancelled) return;
        setTranscript(tr);
        setGpa(gp);
        setBilling(bl);
        setCertificates(ce);
        setCompetencies(co);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onPay() {
    setPaying(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.publicAuth.pay(token, {});
      if (res.clientSecret) {
        setInfo(t('academics.billing.payStarted'));
      } else {
        setInfo(res.message ?? t('academics.billing.payUnavailable'));
      }
    } catch {
      setInfo(t('academics.billing.payUnavailable'));
    } finally {
      setPaying(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'record', label: t('academics.tabs.record') },
    { id: 'billing', label: t('academics.tabs.billing') },
    { id: 'certificates', label: t('academics.tabs.certificates') },
    { id: 'competencies', label: t('academics.tabs.competencies') }
  ];

  return (
    <section className="section-block">
      <div className="section-header-row">
        <div>
          <h2>{t('academics.title')}</h2>
          <p className="row-subtitle">{t('academics.subtitle')}</p>
        </div>
        {onGoMyCourses ? (
          <button className="ghost-btn" onClick={onGoMyCourses}>
            {t('nav.myCourses')}
          </button>
        ) : null}
      </div>

      <nav className="section-tabs">
        {tabs.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </nav>

      {error ? <p className="public-error">{error}</p> : null}
      {info ? <p className="public-info">{info}</p> : null}
      {loading ? <p>{t('academics.loading')}</p> : null}

      {!loading && tab === 'record' ? (
        <div className="academics-panel">
          <div className="academics-metrics">
            <article className="academics-metric">
              <span>{t('academics.record.gpa')}</span>
              <strong>{gpa?.cumulative_gpa ?? '—'}</strong>
            </article>
            <article className="academics-metric">
              <span>{t('academics.record.completedCredits')}</span>
              <strong>{gpa?.completed_credits ?? 0}</strong>
            </article>
            <article className="academics-metric">
              <span>{t('academics.record.enrollments')}</span>
              <strong>{gpa?.total_enrollments ?? 0}</strong>
            </article>
          </div>
          {transcript.length === 0 ? (
            <p>{t('academics.record.empty')}</p>
          ) : (
            <table className="academics-table">
              <thead>
                <tr>
                  <th>{t('academics.record.course')}</th>
                  <th>{t('academics.record.term')}</th>
                  <th>{t('academics.record.credits')}</th>
                  <th>{t('academics.record.grade')}</th>
                  <th>{t('academics.record.status')}</th>
                </tr>
              </thead>
              <tbody>
                {transcript.map((r) => (
                  <tr key={r.id}>
                    <td>{r.course_name ?? `#${r.moodle_course_id}`}</td>
                    <td>{r.term_name}</td>
                    <td>{r.credit_hours}</td>
                    <td>{r.grade ?? '—'}</td>
                    <td>
                      <span className={`status-pill status-${r.status}`}>{t(`academics.status.${r.status}`, r.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {!loading && tab === 'billing' ? (
        <div className="academics-panel">
          <div className="academics-balance">
            <div>
              <span>{t('academics.billing.balance')}</span>
              <strong>{billing ? money(billing.balanceCents, billing.currency) : '—'}</strong>
            </div>
            <button className="cta-btn" disabled={paying || !billing || billing.balanceCents <= 0} onClick={onPay}>
              {t('academics.billing.pay')}
            </button>
          </div>

          {billing && billing.holds.length > 0 ? (
            <div className="academics-holds">
              {billing.holds.map((h) => (
                <p key={h.id} className="hold-pill">
                  ⚠ {t(`academics.billing.hold.${h.hold_type}`, h.hold_type)} — {h.reason}
                </p>
              ))}
            </div>
          ) : null}

          <h3>{t('academics.billing.movements')}</h3>
          {!billing || billing.ledger.length === 0 ? (
            <p>{t('academics.billing.empty')}</p>
          ) : (
            <table className="academics-table">
              <thead>
                <tr>
                  <th>{t('academics.billing.date')}</th>
                  <th>{t('academics.billing.concept')}</th>
                  <th>{t('academics.billing.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {billing.ledger.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.created_at)}</td>
                    <td>{e.description}</td>
                    <td className={Number(e.amount_cents) < 0 ? 'amount-credit' : 'amount-charge'}>
                      {money(e.amount_cents, e.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {!loading && tab === 'certificates' ? (
        <div className="academics-panel">
          {certificates.length === 0 ? (
            <p>{t('academics.certificates.empty')}</p>
          ) : (
            <div className="academics-cards">
              {certificates.map((c) => (
                <article key={c.id} className="academics-cert">
                  <h3>{c.title}</h3>
                  <p className="cert-meta">{c.course_name ?? c.degree_program_name ?? c.kind}</p>
                  <p className="cert-meta">
                    {t('academics.certificates.issued')}: {fmtDate(c.issued_at)}
                  </p>
                  <p className="cert-serial">{c.serial}</p>
                  <a
                    className="ghost-btn"
                    href={`/api/v1/verify/${encodeURIComponent(c.verification_code)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('academics.certificates.verify')}
                  </a>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!loading && tab === 'competencies' ? (
        <div className="academics-panel">
          {competencies.length === 0 ? (
            <p>{t('academics.competencies.empty')}</p>
          ) : (
            <div className="academics-cards">
              {competencies.map((c) => (
                <article key={c.id} className="academics-competency">
                  <h3>{c.competency_name}</h3>
                  {c.description ? <p className="cert-meta">{c.description}</p> : null}
                  <span className={`status-pill status-${c.status}`}>
                    {t(`academics.competencies.status.${c.status}`, c.status)}
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
