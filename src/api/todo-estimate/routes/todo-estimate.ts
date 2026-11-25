/**
 * Estimated hours per ToDo – visible to and editable by Backoffice Managers only.
 * The `estimatedHours` attribute is private, so the normal /api/todos never returns it.
 */
export default {
  routes: [
    { method: 'GET', path: '/todo-estimates', handler: 'todo-estimate.find' },
    { method: 'PUT', path: '/todo-estimates/:documentId', handler: 'todo-estimate.update' },
  ],
};
