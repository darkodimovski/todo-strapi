export default {
  routes: [
    ...require('./routes/email-test').default.routes,
  ],
  controllers: require('./controllers/email-test').default,
  services: require('./services/email-test').default,
};
