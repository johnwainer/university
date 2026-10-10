import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { SECTIONS, SECTION_IDS, PERMISSION_LEVELS } from './sections.js';
import { hashPassword, permisosDeRol } from './service.js';

/**
 * Gestor de roles y usuarios del panel.
 *
 * Todas estas rutas cuelgan de /admin/iam, que el guardián global protege con
 * la sección 'roles'. Es decir: sólo quien tenga 'roles' en nivel edit puede
 * cambiar permisos, y quien lo tenga en view puede mirarlos sin tocar.
 */
export interface IamContext {
  pool: Pool;
  ensureAdmin: (request: any) => any;
}

const rolSchema = z.object({
  key: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'sólo minúsculas, números y guiones'),
  nameEs: z.string().min(1),
  nameEn: z.string().min(1),
  descriptionEs: z.string().optional(),
  descriptionEn: z.string().optional()
});

const permisosSchema = z.object({
  permisos: z.record(z.enum(['none', 'view', 'edit']))
});

const usuarioSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(10, 'mínimo 10 caracteres'),
  roleId: z.string().uuid(),
  locale: z.enum(['es', 'en']).default('es'),
  isActive: z.boolean().default(true)
});

const usuarioUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  // Opcional a propósito: dejarla vacía significa "no cambiar la contraseña".
  password: z.string().min(10).optional(),
  roleId: z.string().uuid().optional(),
  locale: z.enum(['es', 'en']).optional(),
  isActive: z.boolean().optional()
});

export function registerIamRoutes(app: FastifyInstance, ctx: IamContext): void {
  const { pool, ensureAdmin } = ctx;

  /** El catálogo de secciones, para que el panel no lleve su propia copia. */
  app.get('/admin/iam/sections', async (request) => {
    ensureAdmin(request);
    return { sections: SECTIONS, levels: PERMISSION_LEVELS };
  });

  app.get('/admin/iam/roles', async (request) => {
    ensureAdmin(request);
    const { rows } = await pool.query(
      `SELECT r.id, r.key, r.name_es, r.name_en, r.description_es, r.description_en,
              r.is_system, r.created_at,
              (SELECT count(*) FROM admin_users u WHERE u.role_id = r.id)::int AS usuarios
         FROM admin_roles r ORDER BY r.is_system DESC, r.name_es`
    );
    const roles = [];
    for (const r of rows) {
      roles.push({
        id: r.id,
        key: r.key,
        nameEs: r.name_es,
        nameEn: r.name_en,
        descriptionEs: r.description_es,
        descriptionEn: r.description_en,
        isSystem: r.is_system,
        usuarios: r.usuarios,
        permisos: await permisosDeRol(pool, r.id)
      });
    }
    return { roles };
  });

  app.post('/admin/iam/roles', async (request, reply) => {
    ensureAdmin(request);
    const body = rolSchema.parse(request.body);
    const existe = await pool.query('SELECT 1 FROM admin_roles WHERE key = $1', [body.key]);
    if (existe.rowCount) return reply.conflict('Ya existe un rol con esa clave');

    const { rows } = await pool.query(
      `INSERT INTO admin_roles (key, name_es, name_en, description_es, description_en, is_system)
       VALUES ($1,$2,$3,$4,$5,false) RETURNING id`,
      [body.key, body.nameEs, body.nameEn, body.descriptionEs ?? null, body.descriptionEn ?? null]
    );
    const roleId = rows[0].id as string;
    // Un rol nuevo nace sin ningún permiso: se conceden a mano desde la matriz.
    for (const s of SECTION_IDS) {
      await pool.query(
        `INSERT INTO admin_role_permissions (role_id, section, level) VALUES ($1,$2,'none')`,
        [roleId, s]
      );
    }
    return { id: roleId, created: true };
  });

  app.patch('/admin/iam/roles/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const body = rolSchema.partial().parse(request.body);

    const actual = await pool.query('SELECT is_system FROM admin_roles WHERE id = $1', [id]);
    if (!actual.rowCount) return reply.notFound('Rol no encontrado');
    // La clave de un rol de sistema es la que consulta el código; renombrarla
    // dejaría 'superadmin' sin efecto. El nombre visible sí se puede cambiar.
    if (actual.rows[0].is_system && body.key) {
      return reply.badRequest('No se puede cambiar la clave de un rol de sistema');
    }

    await pool.query(
      `UPDATE admin_roles SET
         key = COALESCE($2, key),
         name_es = COALESCE($3, name_es),
         name_en = COALESCE($4, name_en),
         description_es = COALESCE($5, description_es),
         description_en = COALESCE($6, description_en),
         updated_at = now()
       WHERE id = $1`,
      [id, body.key ?? null, body.nameEs ?? null, body.nameEn ?? null,
       body.descriptionEs ?? null, body.descriptionEn ?? null]
    );
    return { updated: true };
  });

  /** La matriz completa de un rol, en una sola operación. */
  app.put('/admin/iam/roles/:id/permissions', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const { permisos } = permisosSchema.parse(request.body);

    const rol = await pool.query('SELECT key, is_system FROM admin_roles WHERE id = $1', [id]);
    if (!rol.rowCount) return reply.notFound('Rol no encontrado');

    // El superadministrador no se puede recortar. Si se pudiera, bastaría un
    // clic para dejar la plataforma sin nadie capaz de volver a conceder
    // permisos, y habría que entrar por el .env a rescatarla.
    if (rol.rows[0].key === 'superadmin') {
      return reply.badRequest('Los permisos del superadministrador no se pueden modificar');
    }

    const desconocidas = Object.keys(permisos).filter((s) => !SECTION_IDS.includes(s));
    if (desconocidas.length) {
      return reply.badRequest(`Secciones desconocidas: ${desconocidas.join(', ')}`);
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (const seccion of SECTION_IDS) {
        const nivel = permisos[seccion] ?? 'none';
        await cliente.query(
          `INSERT INTO admin_role_permissions (role_id, section, level) VALUES ($1,$2,$3)
           ON CONFLICT (role_id, section) DO UPDATE SET level = EXCLUDED.level`,
          [id, seccion, nivel]
        );
      }
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }
    return { updated: true, permisos: await permisosDeRol(pool, id) };
  });

  app.delete('/admin/iam/roles/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const rol = await pool.query(
      `SELECT r.is_system, (SELECT count(*) FROM admin_users u WHERE u.role_id = r.id)::int AS usuarios
         FROM admin_roles r WHERE r.id = $1`,
      [id]
    );
    if (!rol.rowCount) return reply.notFound('Rol no encontrado');
    if (rol.rows[0].is_system) return reply.badRequest('No se puede borrar un rol de sistema');
    // Con usuarios dentro, borrarlo los dejaría sin permisos de golpe y sin
    // aviso. Se obliga a reasignarlos primero.
    if (rol.rows[0].usuarios > 0) {
      return reply.badRequest(`El rol tiene ${rol.rows[0].usuarios} usuario(s). Reasígnalos antes de borrarlo.`);
    }
    await pool.query('DELETE FROM admin_roles WHERE id = $1', [id]);
    return { deleted: true };
  });

  app.get('/admin/iam/users', async (request) => {
    ensureAdmin(request);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.locale, u.is_active, u.created_at, u.last_login_at,
              u.role_id, r.key AS role_key, r.name_es, r.name_en
         FROM admin_users u LEFT JOIN admin_roles r ON r.id = u.role_id
        ORDER BY u.full_name`
    );
    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        locale: u.locale,
        isActive: u.is_active,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        roleId: u.role_id,
        roleKey: u.role_key,
        roleNameEs: u.name_es,
        roleNameEn: u.name_en
      }))
    };
  });

  app.post('/admin/iam/users', async (request, reply) => {
    ensureAdmin(request);
    const body = usuarioSchema.parse(request.body);
    const existe = await pool.query('SELECT 1 FROM admin_users WHERE lower(email) = lower($1)', [body.email]);
    if (existe.rowCount) return reply.conflict('Ya existe un usuario con ese correo');

    const { salt, hash } = await hashPassword(body.password);
    const { rows } = await pool.query(
      `INSERT INTO admin_users (email, full_name, password_salt, password_hash, role_id, locale, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [body.email, body.fullName, salt, hash, body.roleId, body.locale, body.isActive]
    );
    return { id: rows[0].id, created: true };
  });

  app.patch('/admin/iam/users/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const body = usuarioUpdateSchema.parse(request.body);

    const actual = await pool.query('SELECT id FROM admin_users WHERE id = $1', [id]);
    if (!actual.rowCount) return reply.notFound('Usuario no encontrado');

    let salt: string | null = null;
    let hash: string | null = null;
    if (body.password) ({ salt, hash } = await hashPassword(body.password));

    await pool.query(
      `UPDATE admin_users SET
         full_name = COALESCE($2, full_name),
         role_id = COALESCE($3, role_id),
         locale = COALESCE($4, locale),
         is_active = COALESCE($5, is_active),
         password_salt = COALESCE($6, password_salt),
         password_hash = COALESCE($7, password_hash)
       WHERE id = $1`,
      [id, body.fullName ?? null, body.roleId ?? null, body.locale ?? null,
       body.isActive === undefined ? null : body.isActive, salt, hash]
    );

    // Cambiar la contraseña o desactivar la cuenta tiene que cortar lo que ya
    // estaba abierto; si no, la sesión vieja seguiría sirviendo.
    if (body.password || body.isActive === false) {
      await pool.query('DELETE FROM admin_sessions WHERE admin_user_id = $1', [id]);
    }
    return { updated: true };
  });

  app.delete('/admin/iam/users/:id', async (request, reply) => {
    ensureAdmin(request);
    const { id } = request.params as { id: string };
    const r = await pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
    if (!r.rowCount) return reply.notFound('Usuario no encontrado');
    return { deleted: true };
  });
}
