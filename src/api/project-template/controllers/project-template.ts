import { factories } from '@strapi/strapi';

const UID = 'api::project-template.project-template';

type TemplateTodo = { title: string; description?: string; offsetDays?: number; assigneeId?: number | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);

export default factories.createCoreController(UID, ({ strapi }) => ({
  async apply(ctx) {
    const { documentId } = ctx.params;
    const { name, startDate, clients = [] } = ctx.request.body?.data || {};
    if (!startDate || !ISO.test(startDate)) return ctx.badRequest('startDate (YYYY-MM-DD) is required.');

    const template = await strapi.documents(UID).findOne({ documentId });
    if (!template) return ctx.notFound('Template not found.');

    const project = await strapi.documents('api::project.project').create({
      data: {
        name: name || template.name,
        description: template.description || '',
        startDate,
        endDate: addDays(startDate, Math.max(1, template.durationDays || 30) - 1),
        clients: Array.isArray(clients) ? clients : [],
      } as any,
      status: 'published',
    });

    const users = new Map<number, string>();
    const userDocId = async (id?: number | null) => {
      if (!id) return null;
      if (!users.has(id)) {
        const u = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id } });
        users.set(id, u?.documentId || null);
      }
      return users.get(id);
    };

    const todos = (Array.isArray(template.todos) ? template.todos : []) as TemplateTodo[];
    for (const t of todos) {
      if (!t?.title) continue;
      const assignee = await userDocId(t.assigneeId);
      await strapi.documents('api::todo.todo').create({
        data: {
          title: t.title,
          description: t.description || '',
          dueDate: addDays(startDate, Math.max(0, t.offsetDays || 0)),
          position: 'todo',
          project: project.documentId,
          ...(assignee ? { assignee } : {}),
        } as any,
        status: 'published',
      });
    }

    ctx.body = { data: project, todos: todos.length };
  },

  async fromProject(ctx) {
    const { projectDocumentId } = ctx.params;
    const project: any = await strapi.documents('api::project.project').findOne({
      documentId: projectDocumentId,
      populate: { todos: { populate: ['assignee'] } },
    });
    if (!project) return ctx.notFound('Project not found.');

    const start = project.startDate;
    const todos: TemplateTodo[] = (project.todos || []).map((t) => ({
      title: t.title,
      description: t.description || '',
      offsetDays: start && t.dueDate ? Math.max(0, diffDays(t.dueDate, start)) : 0,
      assigneeId: t.assignee?.id ?? null,
    }));

    const durationDays =
      project.startDate && project.endDate ? Math.max(1, diffDays(project.endDate, project.startDate) + 1) : 30;

    const template = await strapi.documents(UID).create({
      data: {
        name: ctx.request.body?.data?.name || project.name,
        description: project.description || '',
        durationDays,
        todos,
      } as any,
    });

    ctx.body = { data: template };
  },
}));
