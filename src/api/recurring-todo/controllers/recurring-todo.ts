import { factories } from '@strapi/strapi';

const UID = 'api::recurring-todo.recurring-todo';

const isManager = (ctx) => ctx.state.user?.role?.type === 'super_admin';

// estimated hours are for managers only
const hideHours = (entry) => {
  if (entry && typeof entry === 'object') delete entry.estimatedHours;
  return entry;
};

export default factories.createCoreController(UID, ({ strapi }) => ({
  async find(ctx) {
    const res: any = await super.find(ctx);
    if (!isManager(ctx) && Array.isArray(res?.data)) res.data.forEach(hideHours);
    return res;
  },

  async findOne(ctx) {
    const res: any = await super.findOne(ctx);
    if (!isManager(ctx)) hideHours(res?.data);
    return res;
  },

  async generate(ctx) {
    ctx.body = await strapi.service(UID).generateDue();
  },
}));
