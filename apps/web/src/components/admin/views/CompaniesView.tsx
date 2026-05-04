import React, { useState, useEffect } from 'react';
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
      setError(reason instanceof Error ? reason.message : 'Error cargando empresas');
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
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar la empresa seleccionada');
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
      setInfo('Empresa creada exitosamente.');
      setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
      await Promise.all([loadCompanies(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear empresa');
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
      setInfo('Empresa actualizada exitosamente.');
      setSelectedCompanyId('');
      setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
      await Promise.all([loadCompanies(sessionToken), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar empresa');
    } finally {
      setSavingCompany(false);
    }
  };

  const onDeleteCompany = async (id: string) => {
    if (!sessionToken || !confirm('¿Estás seguro de eliminar permanentemente esta empresa y todo lo asociado?')) return;
    try {
      await api.admin.deleteCompany(sessionToken, id);
      setInfo('Empresa eliminada.');
      if (selectedCompanyId === id) setSelectedCompanyId('');
      await loadCompanies(sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar la empresa');
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
      setInfo('Colaborador agregado y sincronizado.');
      setCompanyMemberForm({ userId: '', fullName: '', email: '', locale: 'es' });
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken), loadUsers(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo agregar colaborador');
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
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar colaborador');
    } finally {
      setSavingCompanyMember(false);
    }
  };

  const onDeleteCompanyMember = async (userId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Estás seguro de eliminar a este colaborador?')) return;
    try {
      await api.admin.deleteCompanyMember(sessionToken, selectedCompanyId, userId);
      setInfo('Colaborador eliminado y desmatriculado de cursos de empresa.');
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar el colaborador');
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
      setError('Error cargando los accesos del colaborador.');
      setExpandedMemberId(null);
    }
  };

  const onAddGroupToMember = async (event: React.FormEvent<HTMLFormElement>, userId: string) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !memberGroupFormId) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.addGroupToCompanyMember(sessionToken, selectedCompanyId, userId, memberGroupFormId);
      setInfo('Paquete asignado al colaborador.');
      setMemberGroupFormId('');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al asignar paquete.');
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onRemoveGroupFromMember = async (userId: string, groupId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Quitar este paquete del colaborador?')) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.removeGroupFromCompanyMember(sessionToken, selectedCompanyId, userId, groupId);
      setInfo('Paquete removido del colaborador.');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al remover paquete.');
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
      setInfo('Curso adicional asignado.');
      setMemberCourseFormId('');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al asignar curso adicional.');
    } finally {
      setSavingMemberAssignment(false);
    }
  };

  const onRemoveCourseFromMember = async (userId: string, moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Quitar este curso adicional del colaborador?')) return;
    setSavingMemberAssignment(true);
    try {
      await api.admin.removeCourseFromCompanyMember(sessionToken, selectedCompanyId, userId, moodleCourseId);
      setInfo('Curso adicional removido.');
      const assignments = await api.admin.companyMemberAssignments(sessionToken, selectedCompanyId, userId);
      setMemberAssignments(assignments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al remover curso adicional.');
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
      setInfo('Curso asignado (estudiantes serán matriculados automáticamente).');
      setCompanyCourseId('');
      setCompanyCourseSearch('');
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo asignar curso');
    } finally {
      setSavingCompanyCourse(false);
    }
  };

  const onRemoveCompanyCourse = async (moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Remover este curso? (Los estudiantes serán desmatriculados)')) return;
    setSavingCompanyCourse(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.deleteCompanyCourseAccess(sessionToken, selectedCompanyId, moodleCourseId);
      setInfo('Curso removido exitosamente.');
      await Promise.all([onSelectCompany(selectedCompanyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo remover curso');
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
      setInfo('Paquete creado exitosamente.');
      setCompanyGroupForm({ name: '', description: '' });
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear paquete');
    } finally {
      setSavingCompanyGroup(false);
    }
  };

  const onDeleteCompanyGroup = async (groupId: string) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Estás seguro de eliminar este paquete?')) return;
    try {
      await api.admin.deleteCompanyCourseGroup(sessionToken, selectedCompanyId, groupId);
      setInfo('Paquete eliminado.');
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar paquete');
    }
  };

  const onAddCourseToGroup = async (event: React.FormEvent<HTMLFormElement>, groupId: string) => {
    event.preventDefault();
    if (!sessionToken || !selectedCompanyId || !groupCourseId) return;
    setSavingCompanyGroup(true);
    try {
      await api.admin.addCourseToCompanyGroup(sessionToken, selectedCompanyId, groupId, Number(groupCourseId));
      setInfo('Curso añadido al paquete.');
      setGroupCourseId('');
      setGroupCourseSearch('');
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo añadir curso al paquete');
    } finally {
      setSavingCompanyGroup(false);
    }
  };

  const onRemoveCourseFromGroup = async (groupId: string, moodleCourseId: number) => {
    if (!sessionToken || !selectedCompanyId || !confirm('¿Remover este curso del paquete?')) return;
    try {
      await api.admin.removeCourseFromCompanyGroup(sessionToken, selectedCompanyId, groupId, moodleCourseId);
      setInfo('Curso removido del paquete.');
      await onSelectCompany(selectedCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo remover curso del paquete');
    }
  };

  const onSyncEnterprise = async (companyId: string) => {
    if (!sessionToken) return;
    setSyncingEnterprise(true);
    setError(null);
    setInfo(null);
    try {
      await api.admin.moodleSyncEnterprise(sessionToken);
      setInfo('Sincronización forzada con Moodle completada.');
      await Promise.all([onSelectCompany(companyId), loadBase(sessionToken)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error al sincronizar empresa');
    } finally {
      setSyncingEnterprise(false);
    }
  };

  return (
    <section className="grid-2">
      <article className="card">
        <h2>{selectedCompanyId ? `Editar empresa: ${companyForm.name}` : 'Crear empresa'}</h2>
        <form className="login-form" onSubmit={(e) => {
          if (selectedCompanyId) { void onUpdateCompany(); e.preventDefault(); }
          else { void onCreateCompany(e); }
        }}>
          <label>Nombre empresa</label>
          <input
            value={companyForm.name}
            onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Empresa ABC"
            required
          />
          <label>Slug (opcional)</label>
          <input
            value={companyForm.slug}
            onChange={(event) => setCompanyForm((current) => ({ ...current, slug: event.target.value }))}
            placeholder="empresa-abc"
          />
          <label>Descripción</label>
          <input
            value={companyForm.description}
            onChange={(event) => setCompanyForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Programa empresarial"
          />
          <label>Email de contacto</label>
          <input
            type="email"
            value={companyForm.contactEmail}
            onChange={(event) => setCompanyForm((current) => ({ ...current, contactEmail: event.target.value }))}
            placeholder="rrhh@empresa.com"
          />
          <label>Representante</label>
          <select
            value={companyForm.representativeUserId}
            onChange={(event) =>
              setCompanyForm((current) => ({ ...current, representativeUserId: event.target.value }))
            }
            required
          >
            <option value="">Selecciona representante</option>
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
            Empresa activa
          </label>
          <button type="submit" disabled={savingCompany}>
            {savingCompany ? 'Guardando...' : selectedCompanyId ? 'Actualizar empresa' : 'Crear empresa'}
          </button>
          {selectedCompanyId && (
            <button type="button" className="ghost" onClick={() => {
              setSelectedCompanyId('');
              setCompanyForm({ name: '', slug: '', description: '', contactEmail: '', representativeUserId: '', isActive: true });
            }}>Cancelar edición</button>
          )}
        </form>
      </article>

      <article className="card scroll-card">
        <h2>Empresas ({companiesData.length})</h2>
        {loadingCompanies ? <p>Cargando empresas...</p> : null}
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Representante</th>
              <th>Miembros</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {companiesData.length === 0 ? (
              <tr>
                <td colSpan={5}>No hay empresas creadas.</td>
              </tr>
            ) : (
              companiesData.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.representative_name ?? company.representative_email ?? '-'}</td>
                  <td>{company.members_total ?? 0}</td>
                  <td>{company.is_active ? 'activa' : 'inactiva'}</td>
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
                      Gestionar
                    </button>
                    <button className="ghost danger" onClick={() => void onDeleteCompany(company.id)}>
                      Borrar
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
          <h2>Agregar colaborador</h2>
          {selectedCompanyId && (
            <button className="ghost" onClick={() => void onSyncEnterprise(selectedCompanyId)} disabled={syncingEnterprise}>
              {syncingEnterprise ? 'Sincronizando...' : 'Sync Moodle'}
            </button>
          )}
        </div>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para gestionar sus colaboradores.</p>
        ) : (
          <form className="login-form" onSubmit={onAddCompanyMember}>
            <label>Usuario existente (opcional)</label>
            <select
              value={companyMemberForm.userId}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, userId: event.target.value }))
              }
            >
              <option value="">Crear nuevo colaborador</option>
              {currentUsers
                .filter((user) => user.status === 'active')
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.email})
                  </option>
                ))}
            </select>
            <label>Nombre (si es nuevo)</label>
            <input
              value={companyMemberForm.fullName}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, fullName: event.target.value }))
              }
              placeholder="Carlos Gómez"
            />
            <label>Email (si es nuevo)</label>
            <input
              type="email"
              value={companyMemberForm.email}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="carlos@empresa.com"
            />
            <label>Idioma</label>
            <input
              value={companyMemberForm.locale}
              onChange={(event) =>
                setCompanyMemberForm((current) => ({ ...current, locale: event.target.value }))
              }
              placeholder="es"
            />
            <button type="submit" disabled={savingCompanyMember}>
              {savingCompanyMember ? 'Agregando...' : 'Agregar colaborador'}
            </button>
          </form>
        )}
      </article>

      <article className="card scroll-card">
        <h2>Estadísticas Generales</h2>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para ver sus estadísticas.</p>
        ) : !selectedCompanyStats ? (
          <p>Cargando estadísticas...</p>
        ) : (
            <div className="grid-like-two" style={{ marginBottom: '24px' }}>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>Total Integrantes</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.totalMembers}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>Integrantes Activos</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.activeMembers}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>Matrículas</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.totalEnrollments}</div>
              </div>
              <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <small style={{ color: 'var(--text-muted)' }}>Progreso Promedio</small>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{selectedCompanyStats.averageProgress}%</div>
              </div>
          </div>
        )}
      </article>

      {selectedCompanyStats && selectedCompanyStats.totalMembers > 0 && (
      <article className="card scroll-card">
        <h2>Distribución de Integrantes</h2>
        <div style={{ width: '100%', height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: 'Activos', value: selectedCompanyStats.activeMembers },
                  { name: 'Inactivos', value: selectedCompanyStats.totalMembers - selectedCompanyStats.activeMembers }
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
        <h2>Colaboradores de la empresa</h2>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para ver colaboradores.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>ID externo</th>
                <th>Accesos directos</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {selectedCompanyMembers.length === 0 ? (
                <tr>
                  <td colSpan={7}>No hay colaboradores en esta empresa.</td>
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
                              placeholder="Nombre"
                            />
                          </td>
                          <td>
                            <input
                              value={editingCompanyMemberForm.email}
                              onChange={(e) => setEditingCompanyMemberForm(curr => ({ ...curr, email: e.target.value }))}
                              placeholder="Email"
                              type="email"
                            />
                          </td>
                          <td>
                            <select
                              value={editingCompanyMemberForm.role}
                              onChange={(e) => setEditingCompanyMemberForm(curr => ({ ...curr, role: e.target.value as 'representative' | 'collaborator' }))}
                            >
                              <option value="collaborator">Collaborator</option>
                              <option value="representative">Representative</option>
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
                                }, 'Colaborador actualizado.')}
                                disabled={savingCompanyMember}
                              >
                                Guardar
                              </button>
                              <button className="ghost" onClick={() => setEditingCompanyMemberId(null)}>
                                Cancelar
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
                                  <strong style={{ color: 'var(--text-muted)' }}>Paquetes:</strong>
                                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                    {member.assigned_groups.map(g => <li key={g.id}>{g.name}</li>)}
                                  </ul>
                                </div>
                              )}
                              {(member.assigned_courses?.length > 0) && (
                                <div>
                                  <strong style={{ color: 'var(--text-muted)' }}>Cursos (indiv):</strong>
                                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                    {member.assigned_courses.map(c => <li key={c.id}>{c.name}</li>)}
                                  </ul>
                                </div>
                              )}
                              {(!member.assigned_groups?.length && !member.assigned_courses?.length) && (
                                <span style={{ color: 'var(--text-muted)' }}>Ninguno</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {member.member_role === 'representative' ? (
                              <div className="inline-actions">
                                <span className="badge">representante</span>
                                <button className="ghost" onClick={() => void onExpandMember(member.user_id)}>Accesos</button>
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
                                  Editar
                                </button>
                                <button
                                  className="ghost"
                                  onClick={() => void onUpdateCompanyMember(member, { status: member.status === 'active' ? 'inactive' : 'active' }, `Colaborador ${member.status === 'active' ? 'desactivado' : 'activado'}.`)}
                                  disabled={savingCompanyMember}
                                >
                                  {member.status === 'active' ? 'Desactivar' : 'Activar'}
                                </button>
                                <button
                                  className="ghost danger"
                                  onClick={() => void onDeleteCompanyMember(member.user_id)}
                                  disabled={savingCompanyMember}
                                >
                                  Eliminar
                                </button>
                                <button className="ghost" onClick={() => void onExpandMember(member.user_id)}>Accesos</button>
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
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Accesos Adicionales de {member.full_name}</h3>
                            {memberAssignments === null ? (
                              <p>Cargando accesos...</p>
                            ) : (
                              <div className="grid-2">
                                <div>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Paquetes de Cursos</h4>
                                  <form className="inline-actions" style={{ marginBottom: '12px' }} onSubmit={(e) => void onAddGroupToMember(e, member.user_id)}>
                                    <select value={memberGroupFormId} onChange={e => setMemberGroupFormId(e.target.value)} required style={{ padding: '6px' }}>
                                      <option value="">Añadir Paquete...</option>
                                      {selectedCompanyGroups.filter(g => !memberAssignments.groups.some(mg => mg.id === g.id)).map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))}
                                    </select>
                                    <button type="submit" disabled={savingMemberAssignment} className="ghost">Asignar</button>
                                  </form>
                                  {memberAssignments.groups.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tiene paquetes adicionales.</p>
                                  ) : (
                                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                                      {memberAssignments.groups.map(g => (
                                        <li key={g.id} style={{ marginBottom: '4px' }}>
                                          <strong>{g.name}</strong> 
                                          <button className="text-danger" style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', padding: 0 }} onClick={() => void onRemoveGroupFromMember(member.user_id, g.id)}>[quitar]</button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                
                                <div>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Cursos Individuales Adicionales</h4>
                                  <form className="inline-actions" style={{ marginBottom: '12px' }} onSubmit={(e) => void onAddCourseToMember(e, member.user_id)}>
                                    <select value={memberCourseFormId} onChange={e => setMemberCourseFormId(e.target.value)} required style={{ padding: '6px' }}>
                                      <option value="">Añadir Curso...</option>
                                      {allCoursesList.filter(c => !memberAssignments.courses.some(mc => mc.moodle_course_id === c.moodle_course_id)).map(c => (
                                        <option key={c.moodle_course_id} value={c.moodle_course_id}>{c.full_name}</option>
                                      ))}
                                    </select>
                                    <button type="submit" disabled={savingMemberAssignment} className="ghost">Añadir</button>
                                  </form>
                                  {memberAssignments.courses.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tiene cursos adicionales específicos.</p>
                                  ) : (
                                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                                      {memberAssignments.courses.map(c => (
                                        <li key={c.moodle_course_id} style={{ marginBottom: '4px' }}>
                                          {c.full_name}
                                          <button className="text-danger" style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', padding: 0 }} onClick={() => void onRemoveCourseFromMember(member.user_id, c.moodle_course_id)}>[quitar]</button>
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
        <h2>Asignar cursos a la empresa</h2>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para asignar cursos.</p>
        ) : (
          <form className="login-form" onSubmit={onAssignCompanyCourse}>
            <label>Buscar curso</label>
            <input
              type="text"
              value={companyCourseSearch}
              onChange={(event) => setCompanyCourseSearch(event.target.value)}
              placeholder="🔍 Escribe para filtrar cursos..."
            />
            <label>Curso seleccionado</label>
            <select value={companyCourseId} onChange={(event) => setCompanyCourseId(event.target.value)} required>
              <option value="">Selecciona curso ({allCoursesList.filter(course => course.full_name.toLowerCase().includes(companyCourseSearch.toLowerCase())).length} disponibles)</option>
              {allCoursesList.filter(course =>
                course.full_name.toLowerCase().includes(companyCourseSearch.toLowerCase())
              ).map((course) => (
                <option key={course.moodle_course_id} value={String(course.moodle_course_id)}>
                  {course.full_name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={savingCompanyCourse}>
              {savingCompanyCourse ? 'Asignando...' : 'Asignar curso'}
            </button>
          </form>
        )}
      </article>

      <article className="card scroll-card">
        <h2>Cursos habilitados por empresa</h2>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para ver sus cursos.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID Moodle</th>
                <th>Nombre del Curso</th>
                <th>Categoría</th>
                <th>Sincronizado</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {selectedCompanyCourses.length === 0 ? (
                <tr>
                  <td colSpan={6}>No hay cursos habilitados para esta empresa.</td>
                </tr>
              ) : (
                selectedCompanyCourses.map((course) => (
                  <tr key={`${course.company_id}-${course.moodle_course_id}`}>
                    <td>{course.moodle_course_id}</td>
                    <td>{course.full_name ?? '-'}</td>
                    <td>-</td>
                    <td>{new Date(course.updated_at).toLocaleString()}</td>
                    <td>{course.is_active ? 'activo' : 'inactivo'}</td>
                    <td>
                      <button
                        className="ghost danger"
                        onClick={() => void onRemoveCompanyCourse(course.moodle_course_id)}
                        disabled={savingCompanyCourse}
                      >
                        Remover
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
        <h2>Paquetes de Cursos (Grupos)</h2>
        {!selectedCompanyId ? (
          <p>Selecciona una empresa para gestionar paquetes.</p>
        ) : (
          <div className="grid-2">
            <div>
              <h3>Crear un paquete</h3>
              <form className="login-form" onSubmit={onCreateCompanyGroup}>
                <label>Nombre del Paquete</label>
                <input
                  type="text"
                  value={companyGroupForm.name}
                  onChange={(e) => setCompanyGroupForm({ ...companyGroupForm, name: e.target.value })}
                  placeholder="Ej: Onboarding Básicos"
                  required
                />
                <label>Descripción</label>
                <input
                  type="text"
                  value={companyGroupForm.description}
                  onChange={(e) => setCompanyGroupForm({ ...companyGroupForm, description: e.target.value })}
                  placeholder="Descripción opcional"
                />
                <button type="submit" disabled={savingCompanyGroup}>Crear Paquete</button>
              </form>
            </div>
            <div>
              <h3>Paquetes Existentes</h3>
              {selectedCompanyGroups.length === 0 ? (
                <p>No hay paquetes creados.</p>
              ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                  {selectedCompanyGroups.map(group => (
                    <div key={group.id} style={{ border: '1px solid var(--border-color)', padding: '12px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <strong style={{ display: 'block' }}>{group.name}</strong>
                          <small style={{ color: 'var(--text-muted)' }}>{group.description}</small>
                        </div>
                        <button className="ghost danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => onDeleteCompanyGroup(group.id)}>Eliminar Paquete</button>
                      </div>
                      
                      <div style={{ marginBottom: '12px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px' }}>
                        <small style={{ display: 'block', marginBottom: '6px', color: 'var(--text-muted)' }}>Añadir curso a paquete:</small>
                        <form style={{ display: 'flex', gap: '8px' }} onSubmit={(e) => onAddCourseToGroup(e, group.id)}>
                          <select value={groupCourseId} onChange={e => setGroupCourseId(e.target.value)} style={{ flex: 1, padding: '4px 8px' }} required>
                            <option value="">Selecciona curso</option>
                            {allCoursesList.map(c => <option key={c.moodle_course_id} value={c.moodle_course_id}>{c.full_name}</option>)}
                          </select>
                          <button type="submit" disabled={savingCompanyGroup} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>+ Añadir</button>
                        </form>
                      </div>

                      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem' }}>
                        {group.items.length === 0 ? <li style={{ color: 'var(--text-muted)' }}>Sin cursos.</li> : null}
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
        <h2>Rendimiento por Colaborador</h2>
        <div style={{ width: '100%', height: '350px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={selectedCompanyMemberProgress.map(p => ({
                name: p.full_name ? `${p.full_name.split(' ')[0]} ${p.course_name ? '(' + p.course_name.substring(0, 10) + '...)' : ''}` : 'N/A',
                curso: p.course_name?.substring(0, 15) ?? 'Sin curso',
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
              <Bar dataKey="progreso" fill="#8884d8" name="Progreso %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      )}

      <article className="card scroll-card">
        <h2>Detalles de Progreso</h2>
        {!selectedCompanyId ? (
           <p>Selecciona una empresa.</p>
        ) : selectedCompanyMemberProgress.length === 0 ? (
           <p>No hay progreso registrado.</p>
        ) : (
            <div className="grid-1">
               <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Curso</th>
                    <th>Progreso</th>
                  </tr>
                </thead>
                <tbody>
                   {selectedCompanyMemberProgress.map((prog, idx) => (
                      <tr key={idx}>
                        <td>{prog.full_name}</td>
                        <td>{prog.course_name ?? <span style={{ color: 'var(--text-muted)' }}>Sin cursos asignados</span>}</td>
                        <td>{prog.progress_percent}%</td>
                      </tr>
                   ))}
                </tbody>
               </table>
            </div>
        )}
      </article>
    </section>
  );
}
