const TODO_UID = 'api::todo.todo';
const MAX_HOURS = 1000;

export default {
  /** { [documentId]: hours } for every ToDo that has an estimate. */
  async find(ctx) {
    const rows = await strapi.db.query(TODO_UID).findMany({
      select: ['documentId', 'estimatedHours'],
      where: { estimatedHours: { $notNull: true } },
    });
    const map: Record<string, number> = {};
    for (const r of rows) map[r.documentId] = Number(r.estimatedHours);
    ctx.body = map;
  },

  async update(ctx) {
    const { documentId } = ctx.params;
    const raw = ctx.request.body?.data?.hours;
    const hours = raw === null || raw === '' || raw === undefined ? null : Number(String(raw).replace(',', '.'));
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS)) {
      return ctx.badRequest(`Hours must be a number between 0 and ${MAX_HOURS}, or empty.`);
    }
    const value = hours === null ? null : Math.round(hours * 100) / 100;

    // update the draft and the published row directly (no new version, no alerts)
    const { count } = await strapi.db.query(TODO_UID).updateMany({
      where: { documentId },
      data: { estimatedHours: value },
    });
    if (!count) return ctx.notFound('ToDo not found.');
    ctx.body = { documentId, hours: value };
  },
};
