import type { Core } from '@strapi/strapi';
import { applyAuthSettings, applyPermissionPolicy } from './bootstrap/permissions';

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
   * - sent for review     → Backoffice Managers (a non-manager's "done" becomes "review")
   * - approved / returned → assignee
   * - status became done  → Backoffice Managers (when a manager closes it directly)
   * - new history note    → assignee + Backoffice Managers
   * The person who made the change is never alerted about it.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    strapi.documents.use(async (context, next) => {
      if (context.uid !== TODO_UID || !['create', 'update'].includes(context.action)) {
        return next();
      }

      const params = context.params as { documentId?: string; data?: Record<string, unknown> };

      // rules for non-managers: no estimated hours, and "done" means "send for review"
      const requestUser = strapi.requestContext.get()?.state?.user;
      let requesterIsManager = false;
      if (requestUser) {
        const role = await strapi.db
          .query('plugin::users-permissions.role')
          .findOne({ where: { users: { id: requestUser.id } } });
        requesterIsManager = role?.type === 'super_admin';
        if (!requesterIsManager && params.data) {
          delete params.data.estimatedHours;
          if (params.data.position === 'done') {
            // already approved ToDos stay done when someone edits them
            const current =
              context.action === 'update' ? (await snapshot(strapi, params.documentId))?.position : null;
            if (current !== 'done') params.data.position = 'review';
          }
        }
      }

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

        // 1b) the previous assignee hears that it's no longer theirs (e.g. a colleague took it over)
        const previous = before?.assignee;
        if (previous && after.assignee?.id !== previous.id && previous.id !== actorId) {
          const tookOver = after.assignee && after.assignee.id === actorId;
          await push.sendToUser(previous.id, {
            title: `🔁 ${tookOver ? `${actorName} took over` : 'Reassigned'}: ${after.title || 'ToDo'}`,
            body: after.assignee
              ? `Now assigned to ${after.assignee.username}. You don't need to work on it anymore.`
              : `${actorName} removed you from this ToDo.`,
            url: '/todos',
            tag: `todo-reassigned-${after.documentId}`,
          });
        }

        const alerted = new Set<number>(); // people who already got a status alert for this change
        const title = after.title || 'ToDo';
        const tag = (kind: string) => `todo-${kind}-${after.documentId}`;

        // 2) sent for review → managers
        if (after.position === 'review' && before?.position !== 'review') {
          await push.sendToManagers(
            {
              title: `🔍 Ready for review: ${title}`,
              body: `${actorName} finished it – please approve or return it.`,
              url: '/todos?scope=review',
              tag: tag('review'),
            },
            [actorId]
          );
        }

        if (before) {
          const assigneeId = after.assignee?.id;

          // 3) approved (review → done) → assignee
          if (after.position === 'done' && before.position === 'review') {
            if (assigneeId && assigneeId !== actorId) {
              await push.sendToUser(assigneeId, {
                title: `✅ Approved: ${title}`,
                body: `${actorName} approved your work.`,
                url: '/todos',
                tag: tag('approved'),
              });
              alerted.add(assigneeId);
            }
          } else if (after.position === 'done' && before.position !== 'done') {
            // 3b) a manager closed it directly → other managers
            await push.sendToManagers(
              {
                title: `✅ Done: ${title}`,
                body: `${actorName} marked it as done${after.assignee ? ` (assignee: ${after.assignee.username})` : ''}.`,
                url: '/todos',
                tag: tag('done'),
              },
              [actorId]
            );
          }

          // 4) returned (review → todo / in progress) → assignee, with the reason from the notes
          if (before.position === 'review' && (after.position === 'todo' || after.position === 'in-progress')) {
            if (assigneeId && assigneeId !== actorId) {
              const reason = String(after.descriptionHistory || '') !== String(before.descriptionHistory || '')
                ? lastLine(after.descriptionHistory).slice(0, 160)
                : '';
              await push.sendToUser(assigneeId, {
                title: `↩️ Returned: ${title}`,
                body: reason || `${actorName} sent it back to you.`,
                url: '/todos',
                tag: tag('returned'),
              });
              alerted.add(assigneeId);
            }
          }

          // 5) new note in the description history
          const prevNotes = String(before.descriptionHistory || '').trim();
          const notes = String(after.descriptionHistory || '').trim();
          if (notes && notes !== prevNotes && notes.length > prevNotes.length) {
            const payload = {
              title: `💬 ${actorName} on: ${title}`,
              body: lastLine(notes).slice(0, 160),
              url: '/todos',
              tag: tag('note'),
            };
            if (assigneeId && assigneeId !== actorId && !alerted.has(assigneeId)) {
              await push.sendToUser(assigneeId, payload);
              alerted.add(assigneeId);
            }
            // managers already got the review alert for this change
            if (after.position !== 'review' || before.position === 'review') {
              await push.sendToManagers(payload, [actorId, ...alerted]);
            }
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
    await applyAuthSettings(strapi);

    // catch up on recurring ToDos missed while the server was off (e.g. a laptop at 06:00)
    try {
      await strapi.service('api::recurring-todo.recurring-todo').generateDue();
    } catch (err) {
      strapi.log.warn(`[recurring] startup run failed: ${err?.message}`);
    }
  },
};
