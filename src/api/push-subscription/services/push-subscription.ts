/**
 * push-subscription service: sending web push alerts.
 */
import { factories } from '@strapi/strapi';
import webpush from 'web-push';

const UID = 'api::push-subscription.push-subscription';
const TIME_ZONE = 'Europe/Zagreb';

let vapidReady: boolean | null = null;

function ensureVapid(strapi): boolean {
  if (vapidReady !== null) return vapidReady;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    strapi.log.warn('[push] VAPID keys missing – push notifications are disabled.');
    vapidReady = false;
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

// YYYY-MM-DD in the office time zone
function isoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d);
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export default factories.createCoreService(UID, ({ strapi }) => ({
  /** Send a notification to every device of a user. Returns how many were delivered. */
  async sendToUser(userId: number, payload: PushPayload): Promise<number> {
    if (!userId || !ensureVapid(strapi)) return 0;

    const db = strapi.db.query(UID);
    const subs = await db.findMany({ where: { user: { id: userId } } });
    let delivered = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 }
          );
          delivered++;
        } catch (err) {
          // 404/410: the browser dropped this subscription – forget it
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await db.delete({ where: { id: sub.id } });
          } else {
            strapi.log.warn(`[push] send failed (${err?.statusCode || err?.message})`);
          }
        }
      })
    );

    return delivered;
  },

  /**
   * Daily summary per assignee: overdue, due today and due tomorrow ToDos.
   * Runs from the cron task; `onlyUserId` limits it to one user (manual test).
   */
  async sendDueAlerts({ onlyUserId }: { onlyUserId?: number } = {}) {
    const now = new Date();
    const today = isoDate(now);
    const tomorrow = isoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    const todos = await strapi.db.query('api::todo.todo').findMany({
      where: {
        publishedAt: { $notNull: true }, // draft & published rows both exist: count each ToDo once
        dueDate: { $notNull: true, $lte: tomorrow },
        $or: [{ position: { $notIn: ['done', 'review'] } }, { position: { $null: true } }],
        assignee: onlyUserId ? { id: onlyUserId } : { id: { $notNull: true } },
      },
      populate: ['assignee'],
      orderBy: { dueDate: 'asc' },
    });

    const byUser = new Map<number, { overdue: any[]; today: any[]; tomorrow: any[] }>();
    for (const t of todos) {
      const uid = t.assignee?.id;
      if (!uid) continue;
      if (!byUser.has(uid)) byUser.set(uid, { overdue: [], today: [], tomorrow: [] });
      const bucket = byUser.get(uid)!;
      if (t.dueDate < today) bucket.overdue.push(t);
      else if (t.dueDate === today) bucket.today.push(t);
      else bucket.tomorrow.push(t);
    }

    let users = 0;
    let delivered = 0;
    for (const [uid, b] of byUser) {
      const parts = [
        b.overdue.length && `${b.overdue.length} overdue`,
        b.today.length && `${b.today.length} due today`,
        b.tomorrow.length && `${b.tomorrow.length} due tomorrow`,
      ].filter(Boolean);
      if (!parts.length) continue;

      const all = [...b.overdue, ...b.today, ...b.tomorrow];
      const lines = all.slice(0, 3).map((t) => `• ${t.title}`);
      const more = all.length - lines.length;

      users++;
      delivered += await this.sendToUser(uid, {
        title: `⏰ ToDos: ${parts.join(', ')}`,
        body: lines.join('\n') + (more > 0 ? `\n+${more} more` : ''),
        url: '/todos',
        tag: 'due-summary',
      });
    }

    strapi.log.info(`[push] due alerts: ${users} user(s), ${delivered} notification(s)`);
    return { users, delivered };
  },

  /** IDs of all users with the Backoffice Manager role. */
  async managerIds(): Promise<number[]> {
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { role: { type: 'super_admin' }, blocked: { $ne: true } },
      select: ['id'],
    });
    return users.map((u) => u.id);
  },

  /** Push to every Backoffice Manager except the given user IDs. */
  async sendToManagers(payload: PushPayload, exclude: (number | undefined)[] = []) {
    const skip = new Set(exclude.filter(Boolean));
    let delivered = 0;
    for (const id of await this.managerIds()) {
      if (!skip.has(id)) delivered += await this.sendToUser(id, payload);
    }
    return delivered;
  },

  /**
   * Weekly team summary for managers (Friday cron): done this week, overdue and
   * still open, plus the people with the most overdue ToDos.
   */
  async sendWeeklyReport() {
    const today = isoDate(new Date());
    const d = new Date(`${today}T00:00:00Z`);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));

    const todos = await strapi.db.query('api::todo.todo').findMany({
      where: { publishedAt: { $notNull: true } },
      populate: ['assignee'],
    });

    let done = 0;
    let inReview = 0;
    let overdue = 0;
    let open = 0;
    const overdueBy = new Map<string, number>();
    for (const t of todos) {
      if (t.position === 'done') {
        if (new Date(t.updatedAt) >= monday) done++;
        continue;
      }
      if (t.position === 'review') {
        inReview++;
        continue;
      }
      open++;
      if (t.dueDate && t.dueDate < today) {
        overdue++;
        const who = t.assignee?.username || 'Unassigned';
        overdueBy.set(who, (overdueBy.get(who) || 0) + 1);
      }
    }

    const top = [...overdueBy.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([who, n]) => `${who}: ${n}`)
      .join(', ');

    const delivered = await this.sendToManagers({
      title: `📊 Week: ${done} done, ${overdue} overdue`,
      body: `${open} open, ${inReview} waiting for your review.${top ? ` Most overdue – ${top}.` : ''}`,
      url: '/report',
      tag: 'weekly-report',
    });
    strapi.log.info(`[push] weekly report sent to managers (${delivered} notification(s))`);
    return { done, inReview, overdue, open, delivered };
  },

  /** Alert (push + e-mail if configured) when a ToDo gets a new assignee. */
  async notifyAssigned(todo: any, assignee: { id: number; email?: string; username?: string }) {
    const due = todo.dueDate ? `Due ${todo.dueDate}` : 'No due date';

    await this.sendToUser(assignee.id, {
      title: `📝 New ToDo: ${todo.title || 'Untitled'}`,
      body: `${due}${todo.description ? ` – ${String(todo.description).slice(0, 120)}` : ''}`,
      url: '/todos',
      tag: `todo-${todo.documentId}`,
    });

    if (assignee.email && process.env.EMAIL_USER) {
      try {
        await strapi.plugin('email').service('email').send({
          to: assignee.email,
          subject: `📝 New ToDo Assigned: ${todo.title}`,
          text: `Hello ${assignee.username || ''},\n\nYou have a new ToDo:\n\nTitle: ${todo.title}\nDescription: ${todo.description || ''}\nDue: ${todo.dueDate || 'No due date'}\n\nCheck the task app for more info.`,
        });
      } catch (err) {
        strapi.log.warn(`[email] assignment mail failed: ${err?.message}`);
      }
    }
  },
}));
