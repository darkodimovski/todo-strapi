export default ({ env }) => {
  const client = env('DATABASE_CLIENT', 'sqlite');

  return {
    connection: {
      client,
      connection:
        client === 'mysql'
          ? {
              host: env('DATABASE_HOST', 'localhost'),
              port: env.int('DATABASE_PORT', 3306),
              database: env('DATABASE_NAME', 'strapi'),
              user: env('DATABASE_USERNAME', 'strapi'),
              password: env('DATABASE_PASSWORD', 'strapi'),
              ssl: env.bool('DATABASE_SSL', false) ? { rejectUnauthorized: false } : false,
            }
          : {
              filename: env('DATABASE_FILENAME', '.tmp/data.db'),
            },
      useNullAsDefault: client === 'sqlite',
    },
  };
};
