/**
 * Recurring ToDos: each active template creates a normal ToDo `leadDays`
 * before its next due date:
 *   workdays – every Monday–Friday
 *   daily    – every day
 *   weekly   – on a weekday
 *   monthly  – on a day of month (31 = last day)
 * Daily templates are always created on the due day itself.
 */
import { factories } from '@strapi/strapi';

const UID = 'api::recurring-todo.recurring-todo';
const TIME_ZONE = 'Europe/Zagreb';

// --- date helpers on plain YYYY-MM-DD strings (no time-zone drift) ---
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDaysIso = (iso: string, n: number) => {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
const diffDays = (a: string, b: string) => Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86400000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Next due date on or after `fromIso` for this template. */
export function nextDueDate(rt: { frequency: string; weekday?: number; monthDay?: number }, fromIso: string): string {
  const from = toUtc(fromIso);

  if (rt.frequency === 'daily') return fromIso;

  if (rt.frequency === 'workdays') {
    const dow = from.getUTCDay(); // 0 = Sunday, 6 = Saturday
    return addDaysIso(fromIso, dow === 6 ? 2 : dow === 0 ? 1 : 0);
  }

  if (rt.frequency === 'monthly') {
    const want = rt.monthDay || 1;
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth();
    for (let i = 0; i < 2; i++) {
      const d = toIso(new Date(Date.UTC(y, m, Math.min(want, daysInMonth(y, m)))));
      if (d >= fromIso) return d;
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }

  // weekly: ISO weekday 1 = Monday … 7 = Sunday
  const want = rt.weekday || 1;
  const current = ((from.getUTCDay() + 6) % 7) + 1;
  return addDaysIso(fromIso, (want - current + 7) % 7);
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

export default factories.createCoreService(UID, ({ strapi }) => ({
  /** Create ToDos for every template whose next occurrence is within its lead time. */
  async generateDue() {
    const today = todayIso();
    const templates = await strapi.db.query(UID).findMany({
      where: { active: true },
      populate: ['assignee', 'project'],
    });

    const created: string[] = [];

    for (const rt of templates) {
      // after an occurrence was created, look for the one after it
      const from = rt.lastGeneratedFor && rt.lastGeneratedFor >= today ? addDaysIso(rt.lastGeneratedFor, 1) : today;
      const due = nextDueDate(rt, from);
      const isDaily = rt.frequency === 'daily' || rt.frequency === 'workdays';
      const lead = isDaily ? 0 : rt.leadDays ?? 2;
      if (diffDays(due, today) > lead) continue;
      if (rt.lastGeneratedFor && due <= rt.lastGeneratedFor) continue;

      await strapi.documents('api::todo.todo').create({
        data: {
          title: `${rt.title} · ${shortDate(due)}`,
          description: rt.description || '',
          dueDate: due,
          position: 'todo',
          ...(rt.estimatedHours != null ? { estimatedHours: rt.estimatedHours } : {}),
          ...(rt.assignee ? { assignee: rt.assignee.documentId } : {}),
          ...(rt.project ? { project: rt.project.documentId } : {}),
        } as any,
        status: 'published',
      });

      await strapi.db.query(UID).update({ where: { id: rt.id }, data: { lastGeneratedFor: due } });
      created.push(`${rt.title} (${due})`);
    }

    if (created.length) strapi.log.info(`[recurring] created ${created.length}: ${created.join(', ')}`);
    return { created: created.length, items: created };
  },
}));
