import { loadLocalEnvFile } from '../config/load-env-file.js';
loadLocalEnvFile();
const { loadConfig } = await import('../config/env.js');
const { TelegramBotApiClient } = await import('../telegram-business/client.js');
const config = loadConfig();
await Promise.all([
    new TelegramBotApiClient(config.telegram.businessBotToken).deleteWebhook(false),
    new TelegramBotApiClient(config.telegram.adminBotToken).deleteWebhook(false),
]);
console.log('Both Telegram webhooks were deleted without dropping pending updates.');
//# sourceMappingURL=telegram-delete-webhooks.js.map