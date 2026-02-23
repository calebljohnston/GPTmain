// PM2 process config — used on the production server
// Start:   pm2 start ecosystem.config.js
// Restart: pm2 restart vita-bot
// Logs:    pm2 logs vita-bot
// Stop:    pm2 stop vita-bot

module.exports = {
  apps: [
    {
      name: 'vita-bot',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
