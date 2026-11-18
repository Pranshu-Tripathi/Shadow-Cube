const { createBot } = require('./src/bot');
const { startWebServer } = require('./src/web/server');

const bot = createBot();

if (bot.context.config.WEB_ENABLED) {
  startWebServer(bot.context);
}

bot.start();
