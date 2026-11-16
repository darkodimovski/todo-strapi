export default {
  /** Every day at 06:00: create ToDos from recurring templates that are coming up. */
  recurringTodos: {
    task: async ({ strapi }) => {
      await strapi.service('api::recurring-todo.recurring-todo').generateDue();
    },
    options: {
      rule: '0 6 * * *',
      tz: 'Europe/Zagreb',
    },
  },

  /** Every working day at 08:00: overdue / due today / due tomorrow summary per user. */
  dueTodoAlerts: {
    task: async ({ strapi }) => {
      await strapi.service('api::push-subscription.push-subscription').sendDueAlerts();
    },
    options: {
      rule: '0 8 * * 1-5',
      tz: 'Europe/Zagreb',
    },
  },

  /** Friday 15:00: weekly team summary for Backoffice Managers. */
  weeklyReport: {
    task: async ({ strapi }) => {
      await strapi.service('api::push-subscription.push-subscription').sendWeeklyReport();
    },
    options: {
      rule: '0 15 * * 5',
      tz: 'Europe/Zagreb',
    },
  },
};
