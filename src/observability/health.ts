import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';
import type { VectorStore } from '../retrieval/qdrant.js';
import type { TelegramApi } from '../telegram-business/client.js';
import { databaseHealthy } from '../database/prisma.js';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    process: boolean;
    configuration: boolean;
    mysql: boolean;
    qdrant: boolean;
    businessWebhook: boolean;
    adminWebhook: boolean;
  };
}

export class HealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vectors: VectorStore,
    private readonly businessTelegram: TelegramApi,
    private readonly adminTelegram: TelegramApi,
    private readonly config: AppConfig,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [mysql, qdrant, businessWebhook, adminWebhook] = await Promise.all([
      databaseHealthy(this.prisma),
      this.vectors.healthy(),
      this.#webhookMatches(
        this.businessTelegram,
        `${this.config.http.publicBaseUrl}${this.config.telegram.businessWebhookPath}`,
      ),
      this.#webhookMatches(
        this.adminTelegram,
        `${this.config.http.publicBaseUrl}${this.config.telegram.adminWebhookPath}`,
      ),
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

  async summary(): Promise<string> {
    const report = await this.readiness();
    const icon = (value: boolean) => (value ? '✅' : '❌');
    return [
      `${icon(report.ready)} وضعیت کلی: ${report.ready ? 'آماده' : 'نیازمند بررسی'}`,
      `${icon(report.checks.mysql)} MySQL`,
      `${icon(report.checks.qdrant)} Qdrant`,
      `${icon(report.checks.businessWebhook)} وب‌هوک ربات تجاری`,
      `${icon(report.checks.adminWebhook)} وب‌هوک ربات مدیریت`,
    ].join('\n');
  }

  async #webhookMatches(telegram: TelegramApi, expectedUrl: string): Promise<boolean> {
    if (this.config.telegram.transport === 'polling') return this.config.nodeEnv !== 'production';
    try {
      return (await telegram.getWebhookInfo()).url === expectedUrl;
    } catch {
      return false;
    }
  }
}
