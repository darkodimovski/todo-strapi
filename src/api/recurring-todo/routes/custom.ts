export default {
  routes: [
    {
      // create any ToDos that are due now (normally done by the daily cron task)
      method: 'POST',
      path: '/recurring-todos/generate',
      handler: 'recurring-todo.generate',
    },
  ],
};
