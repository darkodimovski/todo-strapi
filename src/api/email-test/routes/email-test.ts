export default {
  routes: [
    {
      method: 'GET',
      path: '/email-test',
      handler: 'email-test.send',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
