export default {
  async send(ctx) {
    await strapi.plugins['email'].services.email.send({
      to: 'your.email@gmail.com', // change this to your test address
      subject: '✅ Test Email from Strapi via Gmail',
      text: 'If you are reading this, your Gmail SMTP config is working!',
    });

    ctx.send({ message: 'Test email sent successfully!' });
  },
};
