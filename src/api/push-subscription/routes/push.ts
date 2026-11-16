/**
 * Web push routes. Auth is checked inside the controller (JWT of the
 * logged-in user), so no per-role permissions need to be granted.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/push/public-key',
      handler: 'push-subscription.publicKey',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/push/subscribe',
      handler: 'push-subscription.subscribe',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/push/unsubscribe',
      handler: 'push-subscription.unsubscribe',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/push/test',
      handler: 'push-subscription.test',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/push/due-summary',
      handler: 'push-subscription.dueSummary',
      config: { auth: false },
    },
  ],
};
