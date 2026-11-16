export default {
  routes: [
    {
      // create a project + its ToDos from a template
      method: 'POST',
      path: '/project-templates/:documentId/apply',
      handler: 'project-template.apply',
    },
    {
      // save an existing project (and its ToDos) as a template
      method: 'POST',
      path: '/project-templates/from-project/:projectDocumentId',
      handler: 'project-template.fromProject',
    },
  ],
};
