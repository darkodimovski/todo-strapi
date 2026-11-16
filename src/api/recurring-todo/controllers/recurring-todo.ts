import { factories } from '@strapi/strapi';

const UID = 'api::recurring-todo.recurring-todo';

export default factories.createCoreController(UID, ({ strapi }) => ({
  async generate(ctx) {
    ctx.body = await strapi.service(UID).generateDue();
  },
}));
