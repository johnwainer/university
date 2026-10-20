import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api, CompanyRecord, CompanyMemberRecord, CompanyCourseAccessRecord, CompanyDashboardStats, CompanyUserProgressRecord, CompanyCourseGroup } from '../../../lib/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export function CompaniesView({ 
  sessionToken, 
  setError, 
  setInfo, 
  currentUsers,
  loadUsers,
  loadBase
}: { 
  sessionToken: string; 
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
  currentUsers: any[];
  loadUsers: (token: string) => Promise<void>;
  loadBase: (token: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [companiesData, setCompaniesData] = useState<CompanyRecord[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedCompanyMembers, setSelectedCompanyMembers] = useState<CompanyMemberRecord[]>([]);
  const [selectedCompanyCourses, setSelectedCompanyCourses] = useState<CompanyCourseAccessRecord[]>([]);
  const [selectedCompanyStats, setSelectedCompanyStats] = useState<CompanyDashboardStats | null>(null);
  const [selectedCompanyMemberProgress, setSelectedCompanyMemberProgress] = useState<CompanyUserProgressRecord[]>([]);
  const [selectedCompanyGroups, setSelectedCompanyGroups] = useState<CompanyCourseGroup[]>([]);
  
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingCompanyMember, setSavingCompanyMember] = useState(false);
  const [savingCompanyCourse, setSavingCompanyCourse] = useState(false);
  const [syncingEnterprise, setSyncingEnterprise] = useState(false);

  const [companyForm, setCompanyForm] = useState({
    name: '',
    slug: '',
    description: '',
    contactEmail: '',
    representativeUserId: '',
    isActive: true
  });

  const [companyMemberForm, setCompanyMemberForm] = useState({
    userId: '',
    fullName: '',
    email: '',
    locale: 'es'
  });

  const [companyCourseId, setCompanyCourseId] = useState('');
  const [companyCourseSearch, setCompanyCourseSearch] = useState('');
  const [allCoursesList, setAllCoursesList] = useState<{ moodle_course_id: number; full_name: string }[]>([]);

  const [editingCompanyMemberId, setEditingCompanyMemberId] = useState<string | null>(null);
  const [editingCompanyMemberForm, setEditingCompanyMemberForm] = useState({
    fullName: '',
    email: '',
    role: 'collaborator' as 'representative' | 'collaborator'
  });
  
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberAssignments, setMemberAssignments] = useState<{ groups: any[], courses: any[] } | null>(null);
  const [memberGroupFormId, setMemberGroupFormId] = useState('');
  const [memberCourseFormId, setMemberCourseFormId] = useState('');
  const [savingMemberAssignment, setSavingMemberAssignment] = useState(false);

  const [companyGroupForm, setCompanyGroupForm] = useState({
    name: '',
    description: ''
  });
  const [groupCourseSearch, setGroupCourseSearch] = useState('');
  const [groupCourseId, setGroupCourseId] = useState('');
  const [savingCompanyGroup, setSavingCompanyGroup] = useState(false);

  const loadCompanies = async (token: string) => {
    setLoadingCompanies(true);
    try {
      const response = await api.admin.companies(token);
      setCompaniesData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorCargar'));
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadAllCoursesForDropdown = async (token: string) => {
    try {
      const response = await api.admin.moodleCoursesPage(token, { page: 1, pageSize: 10000 });
      setAllCoursesList(response.items.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } catch {
      // Ignore inner errors for dropdown
    }
  };

  useEffect(() => {
    if (sessionToken) {
      void loadCompanies(sessionToken);
      void loadAllCoursesForDropdown(sessionToken);
    }
  }, [sessionToken]);

  const onSelectCompany = async (companyId: string) => {
    if (!sessionToken || !companyId) return;
    try {
      const [members, courses, statsRes, groups] = await Promise.all([
        api.admin.companyMembers(sessionToken, companyId),
        api.admin.companyCourseAccess(sessionToken, companyId),
        api.admin.companyStats(sessionToken, companyId),
        api.admin.companyCourseGroups(sessionToken, companyId)
      ]);
      setSelectedCompanyId(companyId);
      setSelectedCompanyMembers(members);
      setSelectedCompanyCourses(courses);
      setSelectedCompanyStats(statsRes.stats);
      setSelectedCompanyMemberProgress(statsRes.memberProgress);
      setSelectedCompanyGroups(groups);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorCargarSeleccionada'));
    }
  };

  const onCreateCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken) return;
    setSavingCompany(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.createCompany(sessionToken, {
        name: companyForm.name,
        slug: companyForm.slug || undefined,
        description: companyForm.description || undefined,
        contactEmail: companyForm.contactEmail || undefined,
        representativeUserId: companyForm.representativeUserId,
        isActive: companyForm.isActive
      });
      setInfo(t('admin.companies.creada'));
      setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
      await Promise.all([loadCompanies(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorCrear'));
    } finally {
      setSavingCompany(false);
    }
  };

  const onUpdateCompany = async () => {
    if (!sessionToken || !selectedCompanyId) return;
    setSavingCompany(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.updateCompany(sessionToken, selectedCompanyId, {
        name: companyForm.name,
        slug: companyForm.slug || undefined,
        description: companyForm.description || undefined,
        contactEmail: companyForm.contactEmail || undefined,
        representativeUserId: companyForm.representativeUserId,
        isActive: companyForm.isActive
      });
      setInfo(t('admin.companies.actualizada'));
      setSelectedCompanyId('');
      setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
      await Promise.all([loadCompanies(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorActualizar'));
    } finally {
      setSavingCompany(false);
    }
  };

  const onDeleteCompany = async (id: string) => {
    if (!sessionToken || !confirm(t('admin.companies.confirmEliminar'))) return;
    try {
      await api.admin.deleteCompany(sessionToken, id);
      setInfo(t('admin.companies.eliminada'));
      if (selectedCompanyId === id) setSelectedCompanyId('');
      await loadCompanies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorEliminar'));
    }
  };

  const onAddCompanyMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId) return;
    setSavingCompanyMember(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.addCompanyMember(sessionToken, selectedCompanyId, {
        userId: companyMemberForm.userId || undefined,
        fullName: companyMemberForm.fullName || undefined,
        email: companyMemberForm.email || undefined,
        locale: companyMemberForm.locale || 'es',
        role: 'collaborator'
      });
      setInfo(t('admin.companies.estudianteAgregado'));
      setCompanyMemberForm({ userId: '', fullName: '', email: '', locale: 'es' });
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorAgregarEstudiante'));
    } finally {
      setSavingCompanyMember(false);
    }
  };

  const onUpdateCompanyMember = async (
    member: CompanyMemberRecord,
    changes: { status?: 'active' | 'inactive'; fullName?: string; email?: string; role?: 'representative' | 'collaborator' },
    successMessage: string
  ) => {
    if (!sessionToken || !selectedCompanyId) return;
    setSavingCompanyMember(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.updateCompanyMember(sessionToken, selectedCompanyId, member.user_id, changes);
      setInfo(successMessage);
      setEditingCompanyMemberId(null);
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorActualizarEstudiante'));
    } finally {
      setSavingCompanyMember(false);
    }
  };

  const onDeleteCompanyMember = async (userId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmEliminarEstudiante'))) return;
    try {
      await api.admin.deleteCompanyMember(sessionToken, selectedCompanyId, userId);
      setInfo(t('admin.companies.estudianteEliminado'));
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorEliminarEstudiante'));
    }
  };

  const onExpandMember = async (userId: string) => {
    if (expandedMemberId === userId) {
      setExpandedMemberId(null);
      setMemberAssignments(null);
      return;
    }
    if (!sessionToken || !selectedCompanyId) return;
    try {
      setExpandedMemberId(userId);
      setMemberAssignments(null);
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch {
      setError(t('admin.companies.errorCargarAccesos'));
      setExpandedMemberId(null);
    }
  };

  const onAddGroupToMember = async (event: React.FormEvent<HTMLFormElement>, userId: string) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !memberGroupFormId) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.addGroupToCompanyMember(sessionToken, selectedCompanyId, userId, memberGroupFormId);
      setInfo(t('admin.companies.paqueteAsignado'));
      setMemberGroupFormId('');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorAsignarPaquete'));
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onRemoveGroupFromMember = async (userId: string, groupId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmQuitarPaquete'))) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.removeGroupFromCompanyMember(sessionToken, selectedCompanyId, userId, groupId);
      setInfo(t('admin.companies.paqueteRemovido'));
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorRemoverPaquete'));
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onAddCourseToMember = async (event: React.FormEvent<HTMLFormElement>, userId: string) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !memberCourseFormId) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.addCourseToCompanyMember(sessionToken, selectedCompanyId, userId, Number(memberCourseFormId));
      setInfo(t('admin.companies.cursoAdicionalAsignado'));
      setMemberCourseFormId('');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorAsignarCursoAdicional'));
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onRemoveCourseFromMember = async (userId: string, moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmQuitarCursoAdicional'))) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.removeCourseFromCompanyMember(sessionToken, selectedCompanyId, userId, moodleCourseId);
      setInfo(t('admin.companies.cursoAdicionalRemovido'));
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorRemoverCursoAdicional'));
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onAssignCompanyCourse = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !companyCourseId) return;
    setSavingCompanyCourse(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.upsertCompanyCourseAccess(sessionToken, selectedCompanyId, Number(companyCourseId), {
        isActive: true
      });
      setInfo(t('admin.companies.cursoAsignado'));
      setCompanyCourseId('');
      setCompanyCourseSearch('');
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorAsignarCurso'));
    } finally {
      setSavingCompanyCourse(false);
    }
  };

  const onRemoveCompanyCourse = async (moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmRemoverCurso'))) return;
    setSavingCompanyCourse(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.deleteCompanyCourseAccess(sessionToken, selectedCompanyId, moodleCourseId);
      setInfo(t('admin.companies.cursoRemovido'));
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorRemoverCurso'));
    } finally {
      setSavingCompanyCourse(false);
    }
  };

  const onCreateCompanyGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId) return;
    setSavingCompanyGroup(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.createCompanyCourseGroup(sessionToken, selectedCompanyId, {
        name: companyGroupForm.name,
        description: companyGroupForm.description
      });
      setInfo(t('admin.companies.paqueteCreado'));
      setCompanyGroupForm({ name: '', description: '' });
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorCrearPaquete'));
    } finally {
      setSavingCompanyGroup(false);
    }
  };

  const onDeleteCompanyGroup = async (groupId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmEliminarPaquete'))) return;
    try {
      await api.admin.deleteCompanyCourseGroup(sessionToken, selectedCompanyId, groupId);
      setInfo(t('admin.companies.paqueteEliminado'));
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorEliminarPaquete'));
    }
  };

  const onAddCourseToGroup = async (event: React.FormEvent<HTMLFormElement>, groupId: string) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !groupCourseId) return;
    setSavingCompanyGroup(true);
    try {
      await api.admin.addCourseToCompanyGroup(sessionToken, selectedCompanyId, groupId, Number(groupCourseId));
      setInfo(t('admin.companies.cursoAnadidoPaquete'));
      setGroupCourseId('');
      setGroupCourseSearch('');
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorAnadirCursoPaquete'));
    } finally {
      setSavingCompanyGroup(false);
    }
  };

  const onRemoveCourseFromGroup = async (groupId: string, moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm(t('admin.companies.confirmRemoverCursoPaquete'))) return;
    try {
      await api.admin.removeCourseFromCompanyGroup(sessionToken, selectedCompanyId, groupId, moodleCourseId);
      setInfo(t('admin.companies.cursoRemovidoPaquete'));
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorRemoverCursoPaquete'));
    }
  };

  const onSyncEnterprise = async (companyId: string) => {
    if (!sessionToken) return;
    setSyncingEnterprise(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.moodleSyncEnterprise(sessionToken);
      setInfo(t('admin.companies.syncCompletada'));
      await Promise.all([onSelectCompany(companyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('admin.companies.errorSync'));
    } finally {
      setSyncingEnterprise(false);
    }
  };

  /*
   * La nota de arriba no es decorativa.
   *
   * TFU preguntó literalmente «¿para qué es esta sección? ¿agrupa programas?»,
   * y la pregunta estaba justificada: el módulo se llama «Departamentos» en el
   * menú pero por dentro son `companies` → miembros → grupos de aulas. Agrupa
   * PERSONAS Y AULAS en unidades; no agrupa programas. Lo que agrupa programas
   * es el departamento académico de `degree_programs.department_id`, que vive
   * en SIS.
   *
   * Decirlo en la propia pantalla es más barato que volver a explicarlo por
   * correo cada vez que alguien nuevo entra al panel.
   */
  return (
    <>
      <p className="ad-note">{t('admin.companies.queEsEstaSeccion')}</p>
      <section className="grid-2">
      <article className="card">
        <h2>{selectedCompanyId ? t('admin.companies.editarTitulo', { nombre: companyForm.name }) : t('admin.companies.crearEmpresa')}</h2>
        <form className="login-form" onSubmit={(e) => {
          if (selectedCompanyId) { void onUpdateCompany(); e.preventDefault(); }
          else { void onCreateCompany(e); }
        }}>
          <label>{t('admin.companies.campoNombre')}</label>
          <input
            value={companyForm.name}
            onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))}
            placeholder={t('admin.companies.placeholderNombre')}
            required
          />
          <label>{t('admin.companies.campoSlug')}</label>
          <input
            value={companyForm.slug}
            onChange={(event) => setCompanyForm((current) => ({ ...current, slug: event.target.value }))}
            placeholder={t('admin.companies.placeholderSlug')}
          />
          <label>{t('admin.companies.campoDescripcion')}</label>
          <input
            value={companyForm.description}
            onChange={(event) => setCompanyForm((current) => ({ ...current, description: event.target.value }))}
            placeholder={t('admin.companies.placeholderDescripcion')}
          />
          <label>{t('admin.companies.campoEmail')}</label>
          <input
            type="email"
            value={companyForm.contactEmail}
            onChange={(event) => setCompanyForm((current) => ({ ...current, contactEmail: event.target.value }))}
            placeholder={t('admin.companies.placeholderEmail')}
          />
          <label>{t('admin.companies.campoRepresentante')}</label>
          <select
            value={companyForm.representativeUserId}
            onChange={(event) =>
              setCompanyForm((current) => ({ ...current, representativeUserId: event.target.value }))
            }
            required
          >
            <option value="">{t('admin.companies.optionSeleccionaRepresentante')}</option>
            {currentUsers
              .filter((user) => user.status === 'active')
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name} ({user.email})
                </option>
              ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={companyForm.isActive}
              onChange={(event) => setCompanyForm((current) => ({ ...current, isActive: event.target.checked }))}
            />{' '}
            {t('admin.companies.empresaActiva')}
          </label>
          <button type="submit" disabled={savingCompany}>
            {savingCompany
              ? t('admin.companies.guardando')
              : selectedCompanyId
                ? t('admin.companies.actualizarEmpresa')
                : t('admin.companies.crearEmpresa')}
          </button>
          {selectedCompanyId && (
            <button type="button" className="ghost" onClick={() => {
              setSelectedCompanyId('');
              setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
            }}>{t('admin.companies.cancelarEdicion')}</button>
          )}
        </form>
      </article>

      <article className="card scroll-card">
        <h2>{t('admin.companies.departamentosTitulo', { total: companiesData.length })}</h2>
        {loadingCompanies ? <p>{t('admin.companies.cargandoDepartamentos')}</p> : null}
        <table>
          <thead>
            <tr>
              <th>{t('admin.companies.colEmpresa')}</th>
              <th>{t('admin.companies.colRepresentante')}</th>
              <th>{t('admin.companies.colMiembros')}</th>
              <th>{t('admin.companies.colEstado')}</th>
              <th>{t('admin.companies.colAccion')}</th>
            </tr>
          </thead>
          <tbody>
            {companiesData.length === 0 ? (
              <tr>
                <td colSpan={5}>{t('admin.companies.sinEmpresas')}</td>
              </tr>
            ) : (
              companiesData.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.representative_name ?? company.representative_email ?? '-'}</td>
                  <td>{company.members_total ?? 0}</td>
                  <td>{company.is_active ? t('admin.companies.estadoActiva') : t('admin.companies.estadoInactiva')}</td>
                  <td>
                    <button className="ghost" onClick={() => {
                      setSelectedCompanyId(company.id);
                      setCompanyForm({
                        name: company.name,
                        slug: company.slug ?? '',
                        description: company.description ?? '',
                        contactEmail: company.contact_email ?? '',
                        representativeUserId: company.representative_user_id ?? '',
                        isActive: company.is_active ?? true
                      });
                      void onSelectCompany(company.id);
                    }}>
                      {t('admin.companies.gestionar')}
                    </button>
                    <button className="ghost danger" onClick={() => void onDeleteCompany(company.id)}>
                      {t('admin.companies.borrar')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>

      <article className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{t('admin.companies.agregarEstudiante')}</h2>
          {selectedCompanyId && (
            <button className="ghost" onClick={() => void onSyncEnterprise(selectedCompanyId)} disabled={syncingEnterprise}>
              {syncingEnterprise ? t('admin.companies.sincronizando') : t('admin.companies.syncMoodle')}
            </button>
          )}
        </div>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaDepartamentoEstudiantes')}</p>
        ) : (
          <form className="login-form" onSubmit={onAddCompanyMember}>
            <label>{t('admin.companies.campoUsuarioExistente')}</label>
            <select
              value={companyMemberForm.userId}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, userId: event.target.value }))
              }
            >
              <option value="">{t('admin.companies.optionCrearNuevo')}</option>
              {currentUsers
                .filter((user) => user.status === 'active')
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.email})
                  </option>
                ))}
            </select>
            <label>{t('admin.companies.campoNombreNuevo')}</label>
            <input
              value={companyMemberForm.fullName}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, fullName: event.target.value }))
              }
              placeholder={t('admin.companies.placeholderNombreNuevo')}
            />
            <label>{t('admin.companies.campoEmailNuevo')}</label>
            <input
              type="email"
              value={companyMemberForm.email}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder={t('admin.companies.placeholderEmailNuevo')}
            />
            <label>{t('admin.companies.campoIdioma')}</label>
            <input
              value={companyMemberForm.locale}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, locale: event.target.value }))
              }
              placeholder="es"
            />
            <button type="submit" disabled={savingCompanyMember}>
              {savingCompanyMember ? t('admin.companies.agregando') : t('admin.companies.agregarEstudiante')}
            </button>
          </form>
        )}
      </article>

      <article className="card scroll-card">
        <h2>{t('admin.companies.estadisticasTitulo')}</h2>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaEmpresaEstadisticas')}</p>
        ) : !selectedCompanyStats ? (
          <p>{t('admin.companies.cargandoEstadisticas')}</p>
        ) : (
            <div className="grid-like-two" style={{ marginBottom: '24px' }}>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>{t('admin.companies.totalIntegrantes')}</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.totalMembers}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>{t('admin.companies.integrantesActivos')}</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.activeMembers}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>{t('admin.companies.matriculas')}</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.totalEnrollments}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>{t('admin.companies.progresoPromedio')}</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.averageProgress}%</div>
              </div>
          </div>
        )}
      </article>

      {selectedCompanyStats && selectedCompanyStats.totalMembers > 0 && (
      <article className="card scroll-card">
        <h2>{t('admin.companies.distribucionTitulo')}</h2>
        <div style={{ width: '100%', height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: t('admin.companies.chartActivos'), value: selectedCompanyStats.activeMembers },
                  { name: t('admin.companies.chartInactivos'), value: selectedCompanyStats.totalMembers - selectedCompanyStats.activeMembers }
                ]}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
                label={{ fill: '#f5f5f5', fontSize: '14px' }}
              >
                <Cell fill="#00C49F" />
                <Cell fill="#FF8042" />
              </Pie>
              <Tooltip itemStyle={{ color: '#f5f5f5' }} contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333', color: '#f5f5f5' }} />
              <Legend wrapperStyle={{ color: '#f5f5f5', paddingTop: '10px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </article>
      )}


      <article className="card scroll-card">
        <h2>{t('admin.companies.estudiantesTitulo')}</h2>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaDepartamentoVerEstudiantes')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('admin.companies.colNombre')}</th>
                <th>{t('admin.companies.colEmail')}</th>
                <th>{t('admin.companies.colRol')}</th>
                <th>{t('admin.companies.colEstado')}</th>
                <th>{t('admin.companies.colIdExterno')}</th>
                <th>{t('admin.companies.colAccesosDirectos')}</th>
                <th>{t('admin.companies.colAccion')}</th>
              </tr>
            </thead>
            <tbody>
              {selectedCompanyMembers.length === 0 ? (
                <tr>
                  <td colSpan={7}>{t('admin.companies.sinEstudiantes')}</td>
                </tr>
              ) : (
                selectedCompanyMembers.map((member) => (
                    <React.Fragment key={`${member.company_id}-${member.user_id}`}>
                      <tr>
                      {editingCompanyMemberId === member.user_id ? (
                        <>
                          <td>
                            <input
                              value={editingCompanyMemberForm.fullName}
                              onChange={(e) => setEditingCompanyMemberForm(curr => ({ ...curr, fullName: e.target.value }))}
                              placeholder={t('admin.companies.colNombre')}
                            />
                          </td>
                          <td>
                            <input
                              value={editingCompanyMemberForm.email}
                              onChange={(e) => setEditingCompanyMemberForm(curr => ({ ...curr, email: e.target.value }))}
                              placeholder={t('admin.companies.colEmail')}
                              type="email"
                            />
                          </td>
                          <td>
                            <select
                              value={editingCompanyMemberForm.role}
                              onChange={(e) => setEditingCompanyMemberForm(curr => ({ ...curr, role: e.target.value as 'representative' | 'collaborator' }))}
                            >
                              <option value="collaborator">{t('admin.companies.rolColaborador')}</option>
                              <option value="representative">{t('admin.companies.rolRepresentante')}</option>
                            </select>
                          </td>
                          <td>{member.status}</td>
                          <td>{member.moodle_user_id ?? '-'}</td>
                          <td>-</td>
                          <td>
                            <div className="inline-actions">
                              <button
                                onClick={() => void onUpdateCompanyMember(member, {
                                  fullName: editingCompanyMemberForm.fullName,
                                  email: editingCompanyMemberForm.email,
                                  role: editingCompanyMemberForm.role
                                }, t('admin.companies.estudianteActualizado'))}
                                disabled={savingCompanyMember}
                              >
                                {t('admin.companies.guardar')}
                              </button>
                              <button className="ghost" onClick={() => setEditingCompanyMemberId(null)}>
                                {t('admin.companies.cancelar')}
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{member.full_name}</td>
                          <td>{member.email}</td>
                          <td>{member.member_role}</td>
                          <td>{member.status}</td>
                          <td>{member.moodle_user_id ?? '-'}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                              {(member.assigned_groups?.length > 0) && (
                                <div>
                                  <strong style={{ color: 'var(--text-muted)' }}>{t('admin.companies.etiquetaPaquetes')}</strong>
                                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                    {member.assigned_groups.map(g => <li key={g.id}>{g.name}</li>)}
                                  </ul>
                                </div>
                              )}
                              {(member.assigned_courses?.length > 0) && (
                                <div>
                                  <strong style={{ color: 'var(--text-muted)' }}>{t('admin.companies.etiquetaCursosIndiv')}</strong>
                                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                    {member.assigned_courses.map(c => <li key={c.id}>{c.name}</li>)}
                                  </ul>
                                </div>
                              )}
                              {(!member.assigned_groups?.length && !member.assigned_courses?.length) && (
                                <span style={{ color: 'var(--text-muted)' }}>{t('admin.companies.ninguno')}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {member.member_role === 'representative' ? (
                              <div className="inline-actions">
                                <span className="badge">{t('admin.companies.badgeRepresentante')}</span>
                                <button className="ghost" onClick={() => void onExpandMember(member.user_id)}>{t('admin.companies.accesos')}</button>
                              </div>
                            ) : (
                              <div className="inline-actions">
                                <button
                                  className="ghost"
                                  onClick={() => {
                                    setEditingCompanyMemberId(member.user_id);
                                    setEditingCompanyMemberForm({
                                      fullName: member.full_name ?? '',
                                      email: member.email ?? '',
                                      role: member.member_role as 'representative' | 'collaborator'
                                    });
                                  }}
                                  disabled={savingCompanyMember}
                                >
                                  {t('admin.companies.editar')}
                                </button>
                                <button
                                  className="ghost"
                                  onClick={() => void onUpdateCompanyMember(
                                    member,
                                    { status: member.status === 'active' ? 'inactive' : 'active' },
                                    member.status === 'active'
                                      ? t('admin.companies.estudianteDesactivado')
                                      : t('admin.companies.estudianteActivado')
                                  )}
                                  disabled={savingCompanyMember}
                                >
                                  {member.status === 'active' ? t('admin.companies.desactivar') : t('admin.companies.activar')}
                                </button>
                                <button
                                  className="ghost danger"
                                  onClick={() => void onDeleteCompanyMember(member.user_id)}
                                  disabled={savingCompanyMember}
                                >
                                  {t('admin.companies.eliminar')}
                                </button>
                                <button className="ghost" onClick={() => void onExpandMember(member.user_id)}>{t('admin.companies.accesos')}</button>
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                    {expandedMemberId === member.user_id && (
                      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={7}>
                          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('admin.companies.accesosAdicionalesDe', { nombre: member.full_name })}</h3>
                            {memberAssignments === null ? (
                              <p>{t('admin.companies.cargandoAccesos')}</p>
                            ) : (
                              <div className="grid-2">
                                <div>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>{t('admin.companies.paquetesDeCursos')}</h4>
                                  <form className="inline-actions" style={{ marginBottom: '12px' }} onSubmit={(e) => void onAddGroupToMember(e, member.user_id)}>
                                    <select value={memberGroupFormId} onChange={e => setMemberGroupFormId(e.target.value)} required style={{ padding: '6px' }}>
                                      <option value="">{t('admin.companies.optionAnadirPaquete')}</option>
                                      {selectedCompanyGroups.filter(g => !memberAssignments.groups.some(mg => mg.id === g.id)).map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))}
                                    </select>
                                    <button type="submit" disabled={savingMemberAssignment} className="ghost">{t('admin.companies.asignar')}</button>
                                  </form>
                                  {memberAssignments.groups.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('admin.companies.sinPaquetesAdicionales')}</p>
                                  ) : (
                                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                                      {memberAssignments.groups.map(g => (
                                        <li key={g.id} style={{ marginBottom: '4px' }}>
                                          <strong>{g.name}</strong> 
                                          <button className="text-danger" style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', padding: 0 }} onClick={() => void onRemoveGroupFromMember(member.user_id, g.id)}>{t('admin.companies.quitar')}</button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                
                                <div>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>{t('admin.companies.cursosIndividualesAdicionales')}</h4>
                                  <form className="inline-actions" style={{ marginBottom: '12px' }} onSubmit={(e) => void onAddCourseToMember(e, member.user_id)}>
                                    <select value={memberCourseFormId} onChange={e => setMemberCourseFormId(e.target.value)} required style={{ padding: '6px' }}>
                                      <option value="">{t('admin.companies.optionAnadirCurso')}</option>
                                      {allCoursesList.filter(c => !memberAssignments.courses.some(mc => mc.moodle_course_id === c.moodle_course_id)).map(c => (
                                        <option key={c.moodle_course_id} value={c.moodle_course_id}>{c.full_name}</option>
                                      ))}
                                    </select>
                                    <button type="submit" disabled={savingMemberAssignment} className="ghost">{t('admin.companies.anadir')}</button>
                                  </form>
                                  {memberAssignments.courses.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('admin.companies.sinCursosAdicionales')}</p>
                                  ) : (
                                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                                      {memberAssignments.courses.map(c => (
                                        <li key={c.moodle_course_id} style={{ marginBottom: '4px' }}>
                                          {c.full_name}
                                          <button className="text-danger" style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', padding: 0 }} onClick={() => void onRemoveCourseFromMember(member.user_id, c.moodle_course_id)}>{t('admin.companies.quitar')}</button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        )}
      </article>

      <article className="card">
        <h2>{t('admin.companies.asignarCursosTitulo')}</h2>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaEmpresaAsignar')}</p>
        ) : (
          <form className="login-form" onSubmit={onAssignCompanyCourse}>
            <label>{t('admin.companies.buscarCurso')}</label>
            <input
              type="text"
              value={companyCourseSearch}
              onChange={(event) => setCompanyCourseSearch(event.target.value)}
              placeholder={t('admin.companies.placeholderBuscarCurso')}
            />
            <label>{t('admin.companies.cursoSeleccionado')}</label>
            <select value={companyCourseId} onChange={(event) => setCompanyCourseId(event.target.value)} required>
              <option value="">
                {t('admin.companies.optionSeleccionaCursoDisponibles', {
                  total: allCoursesList.filter(course => course.full_name.toLowerCase().includes(companyCourseSearch.toLowerCase())).length
                })}
              </option>
              {allCoursesList.filter(course =>
                course.full_name.toLowerCase().includes(companyCourseSearch.toLowerCase())
              ).map((course) => (
                <option key={course.moodle_course_id} value={String(course.moodle_course_id)}>
                  {course.full_name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={savingCompanyCourse}>
              {savingCompanyCourse ? t('admin.companies.asignando') : t('admin.companies.asignarCurso')}
            </button>
          </form>
        )}
      </article>

      <article className="card scroll-card">
        <h2>{t('admin.companies.cursosHabilitadosTitulo')}</h2>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaEmpresaCursos')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('admin.companies.colIdMoodle')}</th>
                <th>{t('admin.companies.colNombreCurso')}</th>
                <th>{t('admin.companies.colCategoria')}</th>
                <th>{t('admin.companies.colSincronizado')}</th>
                <th>{t('admin.companies.colEstado')}</th>
                <th>{t('admin.companies.colAccion')}</th>
              </tr>
            </thead>
            <tbody>
              {selectedCompanyCourses.length === 0 ? (
                <tr>
                  <td colSpan={6}>{t('admin.companies.sinCursosHabilitados')}</td>
                </tr>
              ) : (
                selectedCompanyCourses.map((course) => (
                  <tr key={`${course.company_id}-${course.moodle_course_id}`}>
                    <td>{course.moodle_course_id}</td>
                    <td>{course.full_name ?? '-'}</td>
                    <td>-</td>
                    <td>{new Date(course.updated_at).toLocaleString()}</td>
                    <td>{course.is_active ? t('admin.companies.estadoActivo') : t('admin.companies.estadoInactivo')}</td>
                    <td>
                      <button
                        className="ghost danger"
                        onClick={() => void onRemoveCompanyCourse(course.moodle_course_id)}
                        disabled={savingCompanyCourse}
                      >
                        {t('admin.companies.remover')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </article>

      <article className="card scroll-card">
        <h2>{t('admin.companies.paquetesTitulo')}</h2>
        {!selectedCompanyId ? (
          <p>{t('admin.companies.seleccionaEmpresaPaquetes')}</p>
        ) : (
          <div className="grid-2">
            <div>
              <h3>{t('admin.companies.crearPaqueteTitulo')}</h3>
              <form className="login-form" onSubmit={onCreateCompanyGroup}>
                <label>{t('admin.companies.campoNombrePaquete')}</label>
                <input
                  type="text"
                  value={companyGroupForm.name}
                  onChange={(e) => setCompanyGroupForm({ ...companyGroupForm, name: e.target.value })}
                  placeholder={t('admin.companies.placeholderNombrePaquete')}
                  required
                />
                <label>{t('admin.companies.campoDescripcion')}</label>
                <input
                  type="text"
                  value={companyGroupForm.description}
                  onChange={(e) => setCompanyGroupForm({ ...companyGroupForm, description: e.target.value })}
                  placeholder={t('admin.companies.placeholderDescripcionOpcional')}
                />
                <button type="submit" disabled={savingCompanyGroup}>{t('admin.companies.crearPaquete')}</button>
              </form>
            </div>
            <div>
              <h3>{t('admin.companies.paquetesExistentes')}</h3>
              {selectedCompanyGroups.length === 0 ? (
                <p>{t('admin.companies.sinPaquetes')}</p>
              ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                  {selectedCompanyGroups.map(group => (
                    <div key={group.id} style={{ border: '1px solid var(--border-color)', padding: '12px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <strong style={{ display: 'block' }}>{group.name}</strong>
                          <small style={{ color: 'var(--text-muted)' }}>{group.description}</small>
                        </div>
                        <button className="ghost danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => onDeleteCompanyGroup(group.id)}>{t('admin.companies.eliminarPaquete')}</button>
                      </div>
                      
                      <div style={{ marginBottom: '12px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px' }}>
                        <small style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)' }}>{t('admin.companies.anadirCursoAPaquete')}</small>
                        <form style={{ display: 'flex', gap: '8px' }} onSubmit={(e) => onAddCourseToGroup(e, group.id)}>
                          <select value={groupCourseId} onChange={e => setGroupCourseId(e.target.value)} style={{ flex: 1, padding: '4px 8px' }} required>
                            <option value="">{t('admin.companies.optionSeleccionaCurso')}</option>
                            {allCoursesList.map(c => <option key={c.moodle_course_id} value={c.moodle_course_id}>{c.full_name}</option>)}
                          </select>
                          <button type="submit" disabled={savingCompanyGroup} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>{t('admin.companies.anadirCorto')}</button>
                        </form>
                      </div>

                      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                        {group.items.length === 0 ? <li style={{ color: 'var(--text-muted)' }}>{t('admin.companies.sinCursosPaquete')}</li> : null}
                        {group.items.map(item => (
                          <li key={item.moodle_course_id} style={{ marginBottom: '4px' }}>
                            {item.full_name} 
                            <button className="text-danger" style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', padding: 0 }} onClick={() => onRemoveCourseFromGroup(group.id, item.moodle_course_id)}>[x]</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </article>
      
      {selectedCompanyId && selectedCompanyMemberProgress.length > 0 && (
      <article className="card scroll-card">
        <h2>{t('admin.companies.rendimientoTitulo')}</h2>
        <div style={{ width: '100%', height: '350px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={selectedCompanyMemberProgress.map(p => ({
                name: p.full_name ? `${p.full_name.split(' ')[0]} ${p.course_name ? '(' + p.course_name.substring(0, 10) + '...)' : ''}` : 'N/A',
                curso: p.course_name?.substring(0, 15) ?? t('admin.companies.sinCurso'),
                progreso: p.progress_percent,
              }))}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
              <XAxis dataKey="name" stroke="#777" tick={{ fill: '#f5f5f5', fontSize: 12 }} />
              <YAxis stroke="#777" tick={{ fill: '#f5f5f5', fontSize: 12 }} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.1)' }} 
                contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333', color: '#f5f5f5' }}
                itemStyle={{ color: '#f5f5f5' }}
                labelStyle={{ color: '#f5f5f5', fontWeight: 'bold' }}
              />
              <Legend wrapperStyle={{ color: '#f5f5f5', paddingTop: '10px' }} />
              <Bar dataKey="progreso" fill="#8884d8" name={t('admin.companies.chartProgreso')} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      )}

      <article className="card scroll-card">
        <h2>{t('admin.companies.detallesProgresoTitulo')}</h2>
        {!selectedCompanyId ? (
           <p>{t('admin.companies.seleccionaEmpresa')}</p>
        ) : selectedCompanyMemberProgress.length === 0 ? (
           <p>{t('admin.companies.sinProgreso')}</p>
        ) : (
            <div className="grid-1">
               <table>
                <thead>
                  <tr>
                    <th>{t('admin.companies.colEstudiante')}</th>
                    <th>{t('admin.companies.colCurso')}</th>
                    <th>{t('admin.companies.colProgreso')}</th>
                  </tr>
                </thead>
                <tbody>
                   {selectedCompanyMemberProgress.map((prog, idx) => (
                      <tr key={idx}>
                        <td>{prog.full_name}</td>
                        <td>{prog.course_name ?? <span style={{ color: 'var(--text-muted)' }}>{t('admin.companies.sinCursosInscritos')}</span>}</td>
                        <td>{prog.progress_percent}%</td>
                      </tr>
                   ))}
                </tbody>
               </table>
            </div>
        )}
      </article>
      </section>
    </>
  );
}
