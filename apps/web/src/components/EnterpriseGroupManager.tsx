import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    api,
    CompanyCourseGroup,
    EnterpriseOverviewResponse,
    MemberCourseGroupAssoc,
    MemberCourseAssoc
} from '../lib/api';

export function EnterpriseGroupManager({
    token,
    overview,
    onRefresh
}: {
    token: string;
    overview: EnterpriseOverviewResponse;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<CompanyCourseGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form states
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDescription, setNewGroupDescription] = useState('');
    const [selectedGroup, setSelectedGroup] = useState<CompanyCourseGroup | null>(null);

    // Group Courses Selection
    const [selectedCourseId, setSelectedCourseId] = useState('');

    // Member Assignments Selection
    const [assignMemberId, setAssignMemberId] = useState('');
    const [assignCourseId, setAssignCourseId] = useState('');
    const [assignGroupId, setAssignGroupId] = useState('');
    const [memberCourses, setMemberCourses] = useState<MemberCourseAssoc[]>([]);
    const [memberGroups, setMemberGroups] = useState<MemberCourseGroupAssoc[]>([]);
    const [loadingMemberData, setLoadingMemberData] = useState(false);

    const fetchGroups = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.publicAuth.enterpriseGroups(token);
            setGroups(res);
            if (selectedGroup) {
                setSelectedGroup(res.find((g) => g.id === selectedGroup.id) ?? null);
            }
        } catch (e) {
            setError('No se pudieron cargar los grupos');
        } finally {
            setLoading(false);
        }
    }, [token, selectedGroup]);

    useEffect(() => {
        void fetchGroups();
    }, [fetchGroups]);

    const loadMemberData = async (userId: string) => {
        if (!userId) {
            setMemberCourses([]);
            setMemberGroups([]);
            return;
        }
        setLoadingMemberData(true);
        try {
            const [cr, gr] = await Promise.all([
                api.publicAuth.enterpriseMemberCourses(token, userId),
                api.publicAuth.enterpriseMemberGroups(token, userId)
            ]);
            setMemberCourses(cr);
            setMemberGroups(gr);
        } catch {
            setError('No se pudo cargar la asignación del usuario');
        } finally {
            setLoadingMemberData(false);
        }
    };

    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newGroupName.trim()) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseCreateGroup(token, { name: newGroupName, description: newGroupDescription });
            setNewGroupName('');
            setNewGroupDescription('');
            await fetchGroups();
        } catch (e) {
            setError('Error al crear grupo');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteGroup = async (groupId: string) => {
        if (!confirm('¿Seguro que deseas eliminar este grupo?')) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseDeleteGroup(token, groupId);
            setSelectedGroup(null);
            await fetchGroups();
        } catch {
            setError('Error al eliminar grupo');
        } finally {
            setLoading(false);
        }
    };

    const handleAddCourseToGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedGroup || !selectedCourseId) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseAddCourseToGroup(token, selectedGroup.id, Number(selectedCourseId));
            setSelectedCourseId('');
            await fetchGroups();
        } catch {
            setError('Error al añadir curso');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveCourseFromGroup = async (courseId: number) => {
        if (!selectedGroup) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseRemoveCourseFromGroup(token, selectedGroup.id, courseId);
            await fetchGroups();
        } catch {
            setError('Error al remover curso');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignCourseToMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignMemberId || !assignCourseId) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseAddCourseToMember(token, assignMemberId, Number(assignCourseId));
            setAssignCourseId('');
            await loadMemberData(assignMemberId);
            onRefresh();
        } catch {
            setError('Error al asignar el curso');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignGroupToMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignMemberId || !assignGroupId) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseAddGroupToMember(token, assignMemberId, assignGroupId);
            setAssignGroupId('');
            await loadMemberData(assignMemberId);
            onRefresh(); // Refresh overview to recalculate progress and enrolments
        } catch {
            setError('Error al asignar grupo');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveCourseFromMember = async (courseId: number) => {
        if (!assignMemberId) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseRemoveCourseFromMember(token, assignMemberId, courseId);
            await loadMemberData(assignMemberId);
            onRefresh();
        } catch {
            setError('Error al remover curso del usuario');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveGroupFromMember = async (groupId: string) => {
        if (!assignMemberId) return;
        setLoading(true);
        try {
            await api.publicAuth.enterpriseRemoveGroupFromMember(token, assignMemberId, groupId);
            await loadMemberData(assignMemberId);
            onRefresh();
        } catch {
            setError('Error al remover grupo del usuario');
        } finally {
            setLoading(false);
        }
    };

    const availableCourses = overview.courseAccess.filter((c) => c.is_active);

    return (
        <div className="grid-like-two">
            <div className="card-like enterprise-panel-card">
                <h3>{t('enterprise.grupos.titulo')}</h3>
                {error && <p className="public-error">{error}</p>}
                <form className="profile-editor-form" onSubmit={handleCreateGroup}>
                    <label>
                        {t('enterprise.grupos.nombreGrupo')}
                        <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required />
                    </label>
                    <label>
                        {t('enterprise.grupos.descripcion')}
                        <input value={newGroupDescription} onChange={(e) => setNewGroupDescription(e.target.value)} />
                    </label>
                    <button type="submit" className="go-course-btn" disabled={loading}>
                        {t('enterprise.grupos.crearGrupo')}
                    </button>
                </form>

                <ul className="dashboard-list">
                    {groups.map((g) => (
                        <li key={g.id} className="list-row flex-spaced">
                            <span style={{ fontWeight: 600 }}>{g.name}</span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    className="ghost"
                                    onClick={() => setSelectedGroup(g.id === selectedGroup?.id ? null : g)}
                                >
                                    {g.id === selectedGroup?.id ? t('enterprise.grupos.cerrar') : t('enterprise.grupos.editarCursos')}
                                </button>
                                <button className="ghost danger" onClick={() => handleDeleteGroup(g.id)}>
                                    {t('enterprise.grupos.eliminar')}
                                </button>
                            </div>
                        </li>
                    ))}
                    {groups.length === 0 && <p>{t('enterprise.grupos.sinGrupos')}</p>}
                </ul>

                {selectedGroup && (
                    <div style={{ marginTop: '16px', padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <h4>{t('enterprise.grupos.cursosEn', { grupo: selectedGroup.name })}</h4>
                        <form onSubmit={handleAddCourseToGroup} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                            <select
                                value={selectedCourseId}
                                onChange={(e) => setSelectedCourseId(e.target.value)}
                                required
                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            >
                                <option value="">{t('enterprise.grupos.anadirCurso')}</option>
                                {availableCourses
                                    .filter((ac) => !selectedGroup.items.some((i) => i.moodle_course_id === ac.moodle_course_id))
                                    .map((ac) => (
                                        <option key={ac.moodle_course_id} value={ac.moodle_course_id}>
                                            {ac.full_name || t('enterprise.grupos.cursoPorId', { id: ac.moodle_course_id })}
                                        </option>
                                    ))}
                            </select>
                            <button type="submit" className="go-course-btn" style={{ padding: '8px 16px' }} disabled={loading}>
                                {t('enterprise.grupos.anadir')}
                            </button>
                        </form>

                        <ul className="dashboard-list">
                            {selectedGroup.items.map((item) => (
                                <li key={item.moodle_course_id} className="list-row flex-spaced">
                                    <span style={{ fontSize: '0.9rem' }}>{item.full_name || t('enterprise.grupos.cursoPorId', { id: item.moodle_course_id })}</span>
                                    <button className="ghost danger" onClick={() => handleRemoveCourseFromGroup(item.moodle_course_id)}>
                                        {t('enterprise.grupos.remover')}
                                    </button>
                                </li>
                            ))}
                            {selectedGroup.items.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('enterprise.grupos.sinCursosEnGrupo')}</p>}
                        </ul>
                    </div>
                )}
            </div>

            <div className="card-like enterprise-panel-card">
                <h3>{t('enterprise.grupos.asignacionTitulo')}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    {t('enterprise.grupos.asignacionAyuda')}
                </p>

                <select
                    value={assignMemberId}
                    onChange={(e) => {
                        setAssignMemberId(e.target.value);
                        void loadMemberData(e.target.value);
                    }}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                    <option value="">{t('enterprise.grupos.seleccionaEstudiante')}</option>
                    {overview.members.filter(m => m.status === 'active').map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                            {m.full_name || m.email}
                        </option>
                    ))}
                </select>

                {assignMemberId && (
                    <div style={{ marginTop: '16px' }}>
                        {loadingMemberData ? (
                            <p>{t('enterprise.grupos.cargando')}</p>
                        ) : (
                            <>
                                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '16px' }}>
                                    <h4>{t('enterprise.grupos.asignarCursoIndividual')}</h4>
                                    <form onSubmit={handleAssignCourseToMember} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                        <select
                                            value={assignCourseId}
                                            onChange={(e) => setAssignCourseId(e.target.value)}
                                            required
                                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                        >
                                            <option value="">{t('enterprise.grupos.seleccionaCurso')}</option>
                                            {availableCourses
                                                .filter((ac) => !memberCourses.some((c) => c.moodle_course_id === ac.moodle_course_id))
                                                .map((ac) => (
                                                    <option key={ac.moodle_course_id} value={ac.moodle_course_id}>
                                                        {ac.full_name || t('enterprise.grupos.cursoPorId', { id: ac.moodle_course_id })}
                                                    </option>
                                                ))}
                                        </select>
                                        <button type="submit" className="go-course-btn" style={{ padding: '8px 16px' }} disabled={loading}>
                                            {t('enterprise.grupos.asignar')}
                                        </button>
                                    </form>
                                    <ul className="dashboard-list" style={{ marginTop: '8px' }}>
                                        {memberCourses.map((c) => (
                                            <li key={c.moodle_course_id} className="list-row flex-spaced">
                                                <span style={{ fontSize: '0.85rem' }}>{c.full_name || t('enterprise.grupos.cursoPorId', { id: c.moodle_course_id })}</span>
                                                <button className="ghost danger" onClick={() => handleRemoveCourseFromMember(c.moodle_course_id)}>{t('enterprise.grupos.remover')}</button>
                                            </li>
                                        ))}
                                        {memberCourses.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('enterprise.grupos.sinCursosIndividuales')}</span>}
                                    </ul>
                                </div>

                                <div>
                                    <h4>{t('enterprise.grupos.asignarGrupo')}</h4>
                                    <form onSubmit={handleAssignGroupToMember} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                        <select
                                            value={assignGroupId}
                                            onChange={(e) => setAssignGroupId(e.target.value)}
                                            required
                                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                        >
                                            <option value="">{t('enterprise.grupos.seleccionaGrupo')}</option>
                                            {groups
                                                .filter((g) => !memberGroups.some((mg) => mg.id === g.id))
                                                .map((g) => (
                                                    <option key={g.id} value={g.id}>
                                                        {g.name}
                                                    </option>
                                                ))}
                                        </select>
                                        <button type="submit" className="go-course-btn" style={{ padding: '8px 16px' }} disabled={loading}>
                                            {t('enterprise.grupos.anadir')}
                                        </button>
                                    </form>
                                    <ul className="dashboard-list" style={{ marginTop: '8px' }}>
                                        {memberGroups.map((mg) => (
                                            <li key={mg.id} className="list-row flex-spaced">
                                                <span style={{ fontSize: '0.85rem' }}>{mg.name}</span>
                                                <button className="ghost danger" onClick={() => handleRemoveGroupFromMember(mg.id)}>{t('enterprise.grupos.remover')}</button>
                                            </li>
                                        ))}
                                        {memberGroups.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('enterprise.grupos.sinGruposAsignados')}</span>}
                                    </ul>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
