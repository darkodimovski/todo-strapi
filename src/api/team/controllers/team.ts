import crypto from 'crypto';

const USER_UID = 'plugin::users-permissions.user';
const ROLE_TYPES = { manager: 'super_admin', specialist: 'backoffice_specialist', viewer: 'viewer' } as const;
type RoleKey = keyof typeof ROLE_TYPES;

const frontendUrl = () =>
  (process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || 'http://localhost:3000')
    .trim()
    .replace(/\/$/, '');

const roleKeyOf = (type?: string): RoleKey | null =>
  (Object.keys(ROLE_TYPES) as RoleKey[]).find((k) => ROLE_TYPES[k] === type) ?? null;

const toDto = (u: any) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: roleKeyOf(u.role?.type),
  roleName: u.role?.name ?? null,
  blocked: !!u.blocked && !u.pendingApproval,
  pendingApproval: !!u.pendingApproval,
  // a set-password link was sent and not used yet (invite or "forgot password")
  invitePending: !!u.resetPasswordToken,
  createdAt: u.createdAt,
});

async function roleId(key: string) {
  const type = ROLE_TYPES[key as RoleKey];
  if (!type) return null;
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type } });
  return role?.id ?? null;
}

/** Store a one-time token and e-mail a "set your password" link. */
async function sendInvite(user: { id: number; email: string; username: string }, invitedBy?: string) {
  const token = crypto.randomBytes(64).toString('hex');
  await strapi.db.query(USER_UID).update({ where: { id: user.id }, data: { resetPasswordToken: token } });

  const link = `${frontendUrl()}/reset-password?code=${token}&invite=1`;
  const html = `
    <p>Hi ${user.username},</p>
    <p>${invitedBy ? `${invitedBy} added you` : 'You have been added'} to the Backoffice ToDo app.</p>
    <p><a href="${link}">Set your password</a> to get started. Your username is <b>${user.username}</b>
       (you can also log in with this e-mail address).</p>
    <p>If the button doesn't work, open this link:<br>${link}</p>`;

  await strapi.plugin('email').service('email').send({
    to: user.email,
    subject: 'You are invited to the Backoffice ToDo app',
    html,
    text: `Hi ${user.username},\n\nSet your password for the Backoffice ToDo app: ${link}\n\nUsername: ${user.username}`,
  });
  return link;
}

export default {
  async find(ctx) {
    const users = await strapi.db.query(USER_UID).findMany({
      populate: ['role'],
      orderBy: { username: 'asc' },
    });
    ctx.body = users.map(toDto);
  },

  async invite(ctx) {
    const { username, email, role = 'specialist' } = ctx.request.body?.data || {};
    if (!username || String(username).trim().length < 3) return ctx.badRequest('Username must have at least 3 characters.');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return ctx.badRequest('A valid e-mail is required.');

    const rid = await roleId(role);
    if (!rid) return ctx.badRequest('Unknown role.');

    const db = strapi.db.query(USER_UID);
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(username).trim();
    if (await db.findOne({ where: { $or: [{ email: cleanEmail }, { username: cleanName }] } })) {
      return ctx.badRequest('A user with this username or e-mail already exists.');
    }

    // random password nobody knows; the user sets their own via the invite link
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: cleanName,
      email: cleanEmail,
      provider: 'local',
      password: crypto.randomBytes(24).toString('base64url'),
      confirmed: true,
      blocked: false,
      role: rid,
    });

    let emailSent = true;
    try {
      await sendInvite(user, ctx.state.user?.username);
    } catch (err) {
      emailSent = false;
      strapi.log.warn(`[team] invite e-mail failed: ${err?.message}`);
    }

    const full = await db.findOne({ where: { id: user.id }, populate: ['role'] });
    ctx.body = { data: toDto(full), emailSent };
  },

  /** Public sign-up: creates a blocked account that a manager has to approve. */
  async register(ctx) {
    const { username, email, password } = ctx.request.body || {};
    const cleanName = String(username || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanName.length < 3) return ctx.badRequest('Username must have at least 3 characters.');
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return ctx.badRequest('A valid e-mail is required.');
    if (!password || String(password).length < 8) return ctx.badRequest('Password must have at least 8 characters.');

    const db = strapi.db.query(USER_UID);
    if (await db.findOne({ where: { $or: [{ email: cleanEmail }, { username: cleanName }] } })) {
      return ctx.badRequest('This username or e-mail is already registered.');
    }

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: cleanName,
      email: cleanEmail,
      provider: 'local',
      password: String(password),
      confirmed: true,
      blocked: true,
      pendingApproval: true,
      role: await roleId('specialist'),
    });

    try {
      await strapi.service('api::push-subscription.push-subscription').sendToManagers({
        title: '👤 New user waiting for approval',
        body: `${user.username} (${user.email})`,
        url: '/users',
        tag: `signup-${user.id}`,
      });
    } catch (err) {
      strapi.log.warn(`[team] sign-up alert failed: ${err?.message}`);
    }

    ctx.body = { ok: true };
  },

  /** Reject a pending sign-up (only pending accounts can be deleted this way). */
  async remove(ctx) {
    const id = Number(ctx.params.id);
    const db = strapi.db.query(USER_UID);
    const user = await db.findOne({ where: { id } });
    if (!user) return ctx.notFound('User not found.');
    if (!user.pendingApproval) return ctx.badRequest('Only pending sign-ups can be deleted. Deactivate other users instead.');
    await db.delete({ where: { id } });
    ctx.body = { ok: true };
  },

  async update(ctx) {
    const id = Number(ctx.params.id);
    const { role, blocked, approve } = ctx.request.body?.data || {};
    if (id === ctx.state.user?.id && (blocked === true || (role && role !== 'manager'))) {
      return ctx.badRequest("You can't block yourself or remove your own manager role.");
    }

    const data: Record<string, unknown> = {};
    if (role !== undefined) {
      const rid = await roleId(role);
      if (!rid) return ctx.badRequest('Unknown role.');
      data.role = rid;
    }
    if (blocked !== undefined) data.blocked = !!blocked;
    if (approve) {
      data.blocked = false;
      data.pendingApproval = false;
    }

    const db = strapi.db.query(USER_UID);
    if (!(await db.findOne({ where: { id } }))) return ctx.notFound('User not found.');
    await db.update({ where: { id }, data });
    ctx.body = { data: toDto(await db.findOne({ where: { id }, populate: ['role'] })) };
  },

  async resendInvite(ctx) {
    const id = Number(ctx.params.id);
    const user = await strapi.db.query(USER_UID).findOne({ where: { id } });
    if (!user) return ctx.notFound('User not found.');
    if (user.blocked) return ctx.badRequest('User is blocked.');
    try {
      await sendInvite(user, ctx.state.user?.username);
      ctx.body = { ok: true };
    } catch (err) {
      strapi.log.warn(`[team] invite e-mail failed: ${err?.message}`);
      return ctx.badRequest('Could not send the e-mail. Check the e-mail settings on the server.');
    }
  },
};
