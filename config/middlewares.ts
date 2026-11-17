export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    // only the frontend(s) may call the API from a browser
    name: 'strapi::cors',
    config: {
      origin: env.array('CORS_ORIGINS', ['http://localhost:3000']),
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
