import { loadLocalEnvFile } from '../config/load-env-file.js';
loadLocalEnvFile();
const { loadConfig } = await import('../config/env.js');
const { TelegramBotApiClient } = await import('../telegram-business/client.js');
const config = loadConfig();
const business = new TelegramBotApiClient(config.telegram.businessBotToken);
const admin = new TelegramBotApiClient(config.telegram.adminBotToken);
await Promise.all([
    business.setWebhook(`${config.http.publicBaseUrl}${config.telegram.businessWebhookPath}`, config.telegram.businessWebhookSecret, [
        'business_connection',
        'business_message',
        'edited_business_message',
        'deleted_business_messages',
    ]),
    admin.setWebhook(`${config.http.publicBaseUrl}${config.telegram.adminWebhookPath}`, config.telegram.adminWebhookSecret, ['message']),
]);
console.log('Both Telegram webhooks were configured with separate secret tokens.');
//# sourceMappingURL=telegram-set-webhooks.js.map