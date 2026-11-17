/**
 * Team management for Backoffice Managers (permissions are granted in
 * src/bootstrap/permissions.ts), plus public self-registration that waits
 * for a manager's approval.
 */
export default {
  routes: [
    { method: 'GET', path: '/team', handler: 'team.find' },
    { method: 'POST', path: '/team/invite', handler: 'team.invite' },
    { method: 'PUT', path: '/team/:id', handler: 'team.update' },
    { method: 'DELETE', path: '/team/:id', handler: 'team.remove' },
    { method: 'POST', path: '/team/:id/resend-invite', handler: 'team.resendInvite' },
    {
      // anyone can sign up; the account stays blocked until a manager approves it
      method: 'POST',
      path: '/team/register',
      handler: 'team.register',
      config: { auth: false, middlewares: ['plugin::users-permissions.rateLimit'] },
    },
  ],
};
