import { databaseHealthy } from '../database/prisma.js';
export class HealthService {
    prisma;
    vectors;
    businessTelegram;
    adminTelegram;
    config;
    constructor(prisma, vectors, businessTelegram, adminTelegram, config) {
        this.prisma = prisma;
        this.vectors = vectors;
        this.businessTelegram = businessTelegram;
        this.adminTelegram = adminTelegram;
        this.config = config;
    }
    async readiness() {
        const [mysql, qdrant, businessWebhook, adminWebhook] = await Promise.all([
            databaseHealthy(this.prisma),
            this.vectors.healthy(),
            this.#webhookMatches(this.businessTelegram, `${this.config.http.publicBaseUrl}${this.config.telegram.businessWebhookPath}`),
            this.#webhookMatches(this.adminTelegram, `${this.config.http.publicBaseUrl}${this.config.telegram.adminWebhookPath}`),
        ]);
        const checks = {
            process: true,
            configuration: true,
            mysql,
            qdrant,
            businessWebhook,
            adminWebhook,
        };
        return { ready: Object.values(checks).every(Boolean), checks };
    }
    async summary() {
        const report = await this.readiness();
        const icon = (value) => (value ? '✅' : '❌');
        return [
            `${icon(report.ready)} وضعیت کلی: ${report.ready ? 'آماده' : 'نیازمند بررسی'}`,
            `${icon(report.checks.mysql)} MySQL`,
            `${icon(report.checks.qdrant)} Qdrant`,
            `${icon(report.checks.businessWebhook)} وب‌هوک ربات تجاری`,
            `${icon(report.checks.adminWebhook)} وب‌هوک ربات مدیریت`,
        ].join('\n');
    }
    async #webhookMatches(telegram, expectedUrl) {
        if (this.config.telegram.transport === 'polling')
            return this.config.nodeEnv !== 'production';
        try {
            return (await telegram.getWebhookInfo()).url === expectedUrl;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=health.js.map