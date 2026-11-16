import type { Core } from '@strapi/strapi';
import { applyPermissionPolicy } from './bootstrap/permissions';

const TODO_UID = 'api::todo.todo';
const PUSH_UID = 'api::push-subscription.push-subscription';

type TodoSnapshot = {
  documentId: string;
  title?: string;
  position?: string | null;
  descriptionHistory?: string | null;
  assignee?: { id: number; email?: string; username?: string } | null;
};

async function snapshot(strapi: Core.Strapi, documentId?: string): Promise<TodoSnapshot | null> {
  if (!documentId) return null;
  const todo = await strapi.documents(TODO_UID).findOne({
    documentId,
    fields: ['title', 'position', 'descriptionHistory', 'dueDate', 'description'],
    populate: { assignee: { fields: ['id', 'email', 'username'] } },
  });
  return (todo as any) ?? null;
}

const lastLine = (text?: string | null) =>
  String(text || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop() || '';

export default {
  /**
   * ToDo alerts, via a document-service middleware (runs once per create/update,
   * unlike DB lifecycles which fire separately for the draft and published rows):
   * - new assignee        → assignee (push + e-mail)
   * - status became done  → Backoffice Managers
   * - new history note    → assignee + Backoffice Managers
   * The person who made the change is never alerted about it.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.documents.use(async (context, next) => {
      if (context.uid !== TODO_UID || !['create', 'update'].includes(context.action)) {
        return next();
      }

      const params = context.params as { documentId?: string };
      const before = context.action === 'update' ? await snapshot(strapi, params.documentId) : null;

      const result: any = await next();

      try {
        const after = await snapshot(strapi, result?.documentId ?? params.documentId);
        if (!after) return result;

        const actor = strapi.requestContext.get()?.state?.user;
        const actorId: number | undefined = actor?.id;
        const actorName: string = actor?.username || 'Someone';
        const push = strapi.service(PUSH_UID);

        // 1) assigned to someone new
        if (after.assignee && after.assignee.id !== before?.assignee?.id && after.assignee.id !== actorId) {
          await push.notifyAssigned({ ...result, ...after }, after.assignee);
        }

        if (before) {
          // 2) marked as done
          if (after.position === 'done' && before.position !== 'done') {
            await push.sendToManagers(
              {
                title: `✅ Done: ${after.title || 'ToDo'}`,
                body: `${actorName} marked it as done${after.assignee ? ` (assignee: ${after.assignee.username})` : ''}.`,
                url: '/todos',
                tag: `todo-done-${after.documentId}`,
              },
              [actorId]
            );
          }

          // 3) new note in the description history
          const prevNotes = String(before.descriptionHistory || '').trim();
          const notes = String(after.descriptionHistory || '').trim();
          if (notes && notes !== prevNotes && notes.length > prevNotes.length) {
            const payload = {
              title: `💬 ${actorName} on: ${after.title || 'ToDo'}`,
              body: lastLine(notes).slice(0, 160),
              url: '/todos',
              tag: `todo-note-${after.documentId}`,
            };
            const notified = new Set<number>();
            if (after.assignee && after.assignee.id !== actorId) {
              await push.sendToUser(after.assignee.id, payload);
              notified.add(after.assignee.id);
            }
            await push.sendToManagers(payload, [actorId, ...notified]);
          }
        }
      } catch (err) {
        strapi.log.warn(`[push] ToDo alert failed: ${err?.message}`);
      }

      return result;
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await applyPermissionPolicy(strapi);
  },
};
