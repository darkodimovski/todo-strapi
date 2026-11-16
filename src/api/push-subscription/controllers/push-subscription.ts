/**
 * push-subscription controller
 */
import { factories } from '@strapi/strapi';

const UID = 'api::push-subscription.push-subscription';

// Resolve the logged-in user from the Authorization: Bearer <jwt> header.
async function getUserId(ctx): Promise<number | null> {
  try {
    const payload = await strapi.plugin('users-permissions').service('jwt').getToken(ctx);
    return payload?.id ?? null;
  } catch {
    return null;
  }
}

export default factories.createCoreController(UID, ({ strapi }) => ({
  async publicKey(ctx) {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return ctx.notImplemented('Push is not configured (VAPID_PUBLIC_KEY missing).');
    ctx.body = { publicKey: key };
  },

  async subscribe(ctx) {
    const userId = await getUserId(ctx);
    if (!userId) return ctx.unauthorized();

    const sub = ctx.request.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return ctx.badRequest('Invalid push subscription.');
    }

    const db = strapi.db.query(UID);
    const existing = await db.findOne({ where: { endpoint: sub.endpoint } });
    const data = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      userAgent: String(ctx.request.headers['user-agent'] || '').slice(0, 255),
      user: userId,
    };

    if (existing) await db.update({ where: { id: existing.id }, data });
    else await db.create({ data });

    ctx.body = { ok: true };
  },

  async unsubscribe(ctx) {
    const userId = await getUserId(ctx);
    if (!userId) return ctx.unauthorized();

    const endpoint = ctx.request.body?.endpoint;
    if (!endpoint) return ctx.badRequest('Missing endpoint.');

    await strapi.db.query(UID).deleteMany({ where: { endpoint, user: { id: userId } } });
    ctx.body = { ok: true };
  },

  async test(ctx) {
    const userId = await getUserId(ctx);
    if (!userId) return ctx.unauthorized();

    const sent = await strapi.service(UID).sendToUser(userId, {
      title: '🔔 Notifications are on',
      body: 'You will get alerts for assigned and due ToDos.',
      url: '/todos',
      tag: 'test',
    });
    ctx.body = { sent };
  },

  async dueSummary(ctx) {
    const userId = await getUserId(ctx);
    if (!userId) return ctx.unauthorized();

    ctx.body = await strapi.service(UID).sendDueAlerts({ onlyUserId: userId });
  },
}));
