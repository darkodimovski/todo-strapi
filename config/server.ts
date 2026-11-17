import cronTasks from './cron-tasks';

export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // public https address of the API in production (e.g. https://bo-todo-api.duckdns.org)
  url: env('PUBLIC_URL', ''),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: env.bool('CRON_ENABLED', true),
    tasks: cronTasks,
  },
});
