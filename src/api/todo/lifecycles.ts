export default {
  async afterCreate(event) {
    const { result } = event;

    // Make sure there's an assignee
    const assigneeId = result.assignee;
    if (!assigneeId) return;

    // Get the assignee's email
    const assignee = await strapi.entityService.findOne(
      'plugin::users-permissions.user',
      assigneeId,
      { fields: ['email', 'username'] }
    );

    if (!assignee?.email) return;

    // Send email
    await strapi.plugins['email'].services.email.send({
      to: assignee.email,
      subject: `📝 New ToDo Assigned: ${result.title}`,
      text: `Hello ${assignee.username},\n\nYou have a new ToDo:\n\nTitle: ${result.title}\nDescription: ${result.description}\nDue: ${result.dueDate || 'No due date'}\n\nCheck the task app for more info.`,
    });
  },
};
