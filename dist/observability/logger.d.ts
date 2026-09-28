import { type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
export type LogRecord = Record<string, unknown>;
export type LogSink = (record: LogRecord) => void;
export interface AppLogger extends Logger {
    attachSink?(sink: LogSink): () => void;
}
export declare function createLogger(config: AppConfig): AppLogger;
