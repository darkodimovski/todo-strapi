import type { Core } from '@strapi/strapi';

/**
 * Permission policy, applied on every start so local and production databases
 * end up with the same, safe settings (permissions otherwise live only in the DB
 * and are easy to get wrong in the admin panel).
 *
 * - Public (not logged in) may only log in / reset a password.
 * - Logged-in roles get what the frontend needs; nothing more is removed from them
 *   except the ability to edit role permissions from the public API.
 */

const PUBLIC_ALLOWED = new Set([
  'plugin::users-permissions.auth.callback',
  'plugin::users-permissions.auth.connect',
  'plugin::users-permissions.auth.emailConfirmation',
  'plugin::users-permissions.auth.forgotPassword',
  'plugin::users-permissions.auth.resetPassword',
  'plugin::users-permissions.auth.sendEmailConfirmation',
]);

// Never allowed for the generic "authenticated" role (any self-registered user).
const AUTHENTICATED_DENIED = [
  'plugin::users-permissions.role.updateRole',
  'plugin::users-permissions.role.createRole',
  'plugin::users-permissions.role.deleteRole',
];

const crud = (uid: string, actions: string[]) => actions.map((a) => `${uid}.${a}`);

// Make sure these exist for the app's roles (added if missing, never removed).
const REQUIRED: Record<string, string[]> = {
  super_admin: [
    ...crud('api::recurring-todo.recurring-todo', ['find', 'findOne', 'create', 'update', 'delete', 'generate']),
    ...crud('api::project-template.project-template', [
      'find',
      'findOne',
      'create',
      'update',
      'delete',
      'apply',
      'fromProject',
    ]),
    ...crud('api::team.team', ['find', 'invite', 'update', 'remove', 'resendInvite']),
    ...crud('api::todo-estimate.todo-estimate', ['find', 'update']),
    'plugin::users-permissions.auth.changePassword',
  ],
  // read only: no create / update / delete anywhere
  viewer: [
    ...crud('api::todo.todo', ['find', 'findOne']),
    ...crud('api::project.project', ['find', 'findOne']),
    ...crud('api::client.client', ['find', 'findOne']),
    'plugin::users-permissions.user.find',
    'plugin::users-permissions.user.findOne',
    'plugin::users-permissions.user.me',
    'plugin::users-permissions.auth.changePassword',
  ],
  backoffice_specialist: [
    // photos on ToDos
    'plugin::upload.content-api.find',
    'plugin::upload.content-api.findOne',
    'plugin::upload.content-api.upload',
    'plugin::users-permissions.user.me',
    'plugin::users-permissions.auth.changePassword',
    ...crud('api::recurring-todo.recurring-todo', ['find', 'findOne']),
    ...crud('api::project-template.project-template', ['find', 'findOne']),
  ],
};

function hasController(strapi: Core.Strapi, uid: string) {
  try {
    return !!strapi.controller(uid as any);
  } catch {
    return false;
  }
}

/**
 * Login-related settings of the users-permissions plugin:
 * no self-registration, and "forgot password" e-mails link to the frontend.
 */
export async function applyAuthSettings(strapi: Core.Strapi) {
  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const frontend = (process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || 'http://localhost:3000')
    .trim()
    .replace(/\/$/, '');

  const advanced: any = (await store.get({ key: 'advanced' })) || {};
  await store.set({
    key: 'advanced',
    value: { ...advanced, allow_register: false, email_reset_password: `${frontend}/reset-password` },
  });

  const email: any = (await store.get({ key: 'email' })) || {};
  if (email.reset_password?.options) {
    email.reset_password.options = {
      ...email.reset_password.options,
      from: { name: 'Backoffice ToDo', email: process.env.EMAIL_USER || email.reset_password.options.from?.email },
      object: 'Reset your password',
      message: `<p>Hi <%= USER.username %>,</p>
<p>Use this link to choose a new password for the Backoffice ToDo app:</p>
<p><a href="<%= URL %>?code=<%= TOKEN %>"><%= URL %>?code=<%= TOKEN %></a></p>
<p>If you didn't ask for this, you can ignore this e-mail.</p>`,
    };
    await store.set({ key: 'email', value: email });
  }
}

export async function applyPermissionPolicy(strapi: Core.Strapi) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const permQuery = strapi.db.query('plugin::users-permissions.permission');

  // read-only "Viewer" role (showcase / demo accounts)
  if (!(await roleQuery.findOne({ where: { type: 'viewer' } }))) {
    await roleQuery.create({
      data: { name: 'Viewer', type: 'viewer', description: 'Read-only access (showcase)' },
    });
    strapi.log.info('[permissions] created role "Viewer"');
  }

  const roles = await roleQuery.findMany({ populate: ['permissions'] });
  const removed: string[] = [];
  const added: string[] = [];

  for (const role of roles) {
    const perms: { id: number; action: string }[] = role.permissions || [];

    const toRemove = perms.filter((p) => {
      if (role.type === 'public') return !PUBLIC_ALLOWED.has(p.action);
      if (role.type === 'authenticated') return AUTHENTICATED_DENIED.includes(p.action);
      if (role.type === 'viewer') return !(REQUIRED.viewer || []).includes(p.action);
      return false;
    });
    for (const p of toRemove) {
      await permQuery.delete({ where: { id: p.id } });
      removed.push(`${role.name}: ${p.action}`);
    }

    const have = new Set(perms.map((p) => p.action));
    for (const action of REQUIRED[role.type] || []) {
      if (have.has(action)) continue;
      // skip content types that don't exist (yet) in this build
      const uid = action.startsWith('api::') ? action.split('.').slice(0, 2).join('.') : null;
      if (uid && !strapi.contentTypes[uid as keyof typeof strapi.contentTypes] && !hasController(strapi, uid)) continue;
      await permQuery.create({ data: { action, role: role.id } });
      added.push(`${role.name}: ${action}`);
    }
  }

  if (removed.length) strapi.log.info(`[permissions] removed ${removed.length}: ${removed.join(', ')}`);
  if (added.length) strapi.log.info(`[permissions] added ${added.length}: ${added.join(', ')}`);
}
