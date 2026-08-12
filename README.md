# Telegram AI Support

A production-oriented Telegram customer-support system in which customers keep chatting with a normal Telegram support account. An official Telegram Business Connected Bot receives and answers those chats on behalf of the account. A separate, allowlisted Admin Bot is only the authenticated entry point and notification channel for a Persian Telegram Mini App, where knowledge, handoffs, status, and access are managed. There is no customer-facing bot chat and no MTProto user login, phone number, or OTP flow.

## System overview

```mermaid
flowchart LR
    Customer["Customer in normal support-account chat"] --> Telegram["Telegram Business connection"]
    Telegram -->|"business_* updates + secret token"| API["Fastify API"]
    API --> MySQL["MySQL: source of truth"]
    MySQL --> Worker["Durable worker + DB leases"]
    Worker --> NanoGPT["NanoGPT embeddings + grounded decision"]
    Worker --> Qdrant["Qdrant: rebuildable cosine index"]
    Worker -->|"business_connection_id"| Telegram
    Worker --> Outbox["Durable notification outbox"]
    Outbox --> AdminBot["Admin Bot: summary + details link"]
    AdminBot --> MiniApp["Persian Telegram Mini App"]
    MiniApp -->|"signed initData + secure session"| API
    MiniApp --> Human["Authorized owner/admin/support"]
    Human -->|"manual reply in actual support account"| Customer
```

The code is a modular monolith. `telegram-business` owns Bot API ingestion and guarded sends; `telegram-admin` owns the single Mini App launcher and concise durable notifications; `mini-app` owns Telegram `initData` authentication, session/CSRF protection, tenant-scoped authorization, APIs, and static UI delivery; `knowledge` and `indexing` own MySQL-first knowledge changes and durable Qdrant jobs; `retrieval` validates Qdrant candidates against current MySQL state; `ai` enforces structured grounded decisions; `conversations` serializes work per chat; `handoffs` owns atomic mode transitions; `workers` processes durable jobs, notifications, and expiry; `security` and `observability` provide authorization, secret checking, redaction, health, and correlation IDs.

## Important invariants

- MySQL is authoritative. Qdrant can be deleted and rebuilt.
- Every customer message/update is deduplicated before work is queued. A database lease prevents concurrent AI responses in one conversation.
- A model answer is rejected unless it contains at least one supporting chunk ID from the current retrieval result. Retrieved chunks are checked again against the active, non-deleted, `READY` MySQL version.
- Customer text, conversation context, and retrieved knowledge are all treated as untrusted prompt data. They cannot override system instructions.
- Normal AI sends are allowed only in `AI` mode, with an enabled connection, `can_reply`, and an unexpired Telegram reply window. Telegram’s response remains the final authority.
- Entering `HUMAN` mode and creating the handoff is one MySQL transaction. Re-enabling AI never proactively messages the customer.
- The Admin Bot cannot reply to a customer or change system state. Its launch message has one `باز کردن پنل مدیریت` web-app button; every notification has one `مشاهده جزئیات` web-app button. Humans reply only from the actual customer chat inside the connected support account.

## Requirements

- macOS or Linux
- A supported Node.js release: Node `20.19+`, `22.13+`, or `24+` (odd-numbered/EOL releases are intentionally excluded)
- MySQL 8.0+
- A Qdrant Cloud cluster or self-hosted Qdrant URL; Docker is not required
- A NanoGPT API key
- Two BotFather bots: one Business Connected Bot and one separate Admin Bot
- A public HTTPS origin for production webhooks and the Telegram Mini App

## Local setup on macOS

```bash
brew install node@24 mysql
brew services start mysql
cd /Users/mac/projects/telegram-ai-support
cp .env.example .env
npm ci
```

Edit `.env` before running application commands. `.env` is ignored by Git. Do not copy real tokens into `.env.example`.

### MySQL setup

Create a least-privilege application database/user. The migration user needs DDL privileges; a separately provisioned runtime user can be limited to DML after deployment.

```sql
CREATE DATABASE telegram_ai_support CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'support_user'@'localhost' IDENTIFIED BY 'replace-with-a-long-random-password';
GRANT ALL PRIVILEGES ON telegram_ai_support.* TO 'support_user'@'localhost';
FLUSH PRIVILEGES;
```

Set `DATABASE_URL`, then run:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

`prisma:seed` creates or updates the owner from `TELEGRAM_OWNER_ID`, adds `TELEGRAM_INITIAL_ADMIN_IDS`, and grants them access to the initial business account. Set `SEED_BUSINESS_ACCOUNT_ID` and `SEED_BUSINESS_ACCOUNT_NAME` if a stable custom ID/name is required.

### Qdrant Cloud setup

1. Create a cluster at Qdrant Cloud and copy its HTTPS endpoint and API key.
2. Set `QDRANT_URL`, `QDRANT_API_KEY`, and `QDRANT_COLLECTION`.
3. Set `OPENAI_EMBEDDING_MODEL`. Either set its correct `OPENAI_EMBEDDING_DIMENSIONS`, or set dimensions to `0` so `qdrant:init` makes one live embedding probe.
4. Run `npm run qdrant:init`.

The collection uses cosine similarity and keyword/bool payload indexes. A self-hosted HTTPS endpoint works with an empty `QDRANT_API_KEY`.

### NanoGPT setup

Create a NanoGPT API key and set `OPENAI_API_KEY`. Keep `OPENAI_BASE_URL=https://nano-gpt.com/api/v1`; the variable retains its OpenAI name because the bot uses the OpenAI-compatible SDK. `OPENAI_CHAT_MODEL` and `OPENAI_EMBEDDING_MODEL` are configuration, not code constants. Choose model IDs supported by NanoGPT. The implementation uses NanoGPT's OpenAI-compatible Responses API with strict JSON-schema output and `store: false`, plus its embeddings endpoint. No live AI-provider call is made by the test suite.

The durable worker also checks `NANOGPT_BALANCE_URL` once every `NANOGPT_BALANCE_CHECK_INTERVAL_HOURS` (24 by default). When the exact USD balance is below `NANOGPT_LOW_BALANCE_USD` (default `$3`), every active admin receives a warning. A NanoGPT `402`/insufficient-balance response triggers a red-flag alert with a freshly queried exact balance. `NANOGPT_INSUFFICIENT_ALERT_COOLDOWN_HOURS` (default 24) deduplicates these error alerts across retries, worker processes, and restarts. Apply the MySQL migrations before deploying this feature.

Simple greetings use a predefined localized response by default, avoiding retrieval and model calls. Set `SAFE_GREETING_ENABLED=false` to disable that shortcut and route greetings through the normal retrieval/model decision path. Explicit human requests and bot/model-identity probes still hand off before the model.

## Create and configure the Telegram bots

### 1. Business Connected Bot

1. In [@BotFather](https://t.me/BotFather), run `/newbot` and create the business bot.
2. Open the bot’s settings and enable the current Business/Secretary Mode option. Telegram’s current feature guide may label this **Secretary Mode**; older clients and requirements often call it **Business Mode**.
3. Put its token in `TELEGRAM_BUSINESS_BOT_TOKEN`.
4. In the normal support account’s Telegram settings, connect that bot as the account’s business bot and select the customer chats/recipients it may manage.
5. Grant only **Reply to messages** (`can_reply`). Do not grant delete, profile, gift, star, story, or other permissions.
6. Grant **Read messages** (`can_read_messages`) only if you deliberately set `TELEGRAM_MARK_READ=true`. The default is false. When enabled, the bot marks a customer message as read only after successfully sending an AI answer; messages handed to a human remain unread.

Telegram documents the current `BusinessConnection.rights` object and the rule that reply permission applies to private chats with an incoming message in the preceding 24 hours in the [official Bot API](https://core.telegram.org/bots/api) and [Business Bot rights reference](https://core.telegram.org/constructor/businessBotRights). The system accepts the legacy `can_reply` field only for backward compatibility but persists the current complete rights payload.

### 2. Admin Bot

1. Create a second bot with `/newbot` in BotFather.
2. Put its token in `TELEGRAM_ADMIN_BOT_TOKEN`.
3. Put the owner’s numeric Telegram user ID in `TELEGRAM_OWNER_ID` and optional initial IDs in `TELEGRAM_INITIAL_ADMIN_IDS`.
4. Set `MINI_APP_URL` to the public HTTPS `/mini-app` URL (it defaults to `${PUBLIC_BASE_URL}/mini-app`). Configure that HTTPS domain in BotFather if prompted by the Mini App setup.
5. After seeding, open the bot and use its single **باز کردن پنل مدیریت** button. The owner can add `ADMIN` and `SUPPORT` users inside the Mini App; only the owner can change authorization.

The two tokens, webhook paths, and secret tokens must all be distinct.

## Development

For local long polling (development/test only):

```dotenv
NODE_ENV=development
TELEGRAM_TRANSPORT=polling
RUN_WORKERS_IN_API=true
PUBLIC_BASE_URL=https://unused.example
MINI_APP_URL=https://your-https-tunnel.example/mini-app
# Optional localhost-only bypass; never set this in production.
MINI_APP_DEV_ADMIN_ID=123456789
```

Then:

```bash
npm run dev
```

For direct browser testing without Telegram, set `MINI_APP_DEV_ADMIN_ID` to the numeric Telegram ID of an existing active admin, run `npm run dev`, and open `http://127.0.0.1:5173/mini-app/`. Vite serves the React Mini App with hot reload and proxies `/api` to Fastify on port 3000. The bypass accepts loopback requests only, displays a development banner, and configuration validation rejects it in production. A production build is served by Fastify at `http://127.0.0.1:3000/mini-app`.

The process removes existing webhooks without dropping pending updates, starts both polling loops, the HTTP health server, and the durable worker. Production configuration rejects polling. Opening the Mini App from Telegram still requires an HTTPS URL reachable by Telegram. For webhook-style local testing, use an HTTPS tunnel, keep `TELEGRAM_TRANSPORT=webhook`, set both public URLs, run `npm run telegram:set-webhooks`, and run `npm run dev`.

## Production webhooks and processes

Set `NODE_ENV=production`, `TELEGRAM_TRANSPORT=webhook`, `RUN_WORKERS_IN_API=false`, a public HTTPS `PUBLIC_BASE_URL`, and `MINI_APP_URL` when the panel is not served at `${PUBLIC_BASE_URL}/mini-app`. Put a reverse proxy/load balancer in front of Fastify, terminate TLS there, and pass only the intended host/forwarding headers. Generate independent random webhook secrets of at least 32 characters.

```bash
npm ci
npm run prisma:migrate
npm run qdrant:init
npm run telegram:set-webhooks
npm run build
npm prune --omit=dev
npm run start       # API/webhooks
npm run worker:start # separate durable worker process
```

Run the API and worker under `launchd`, systemd, or another process supervisor with restart limits, a non-root OS user, a read-only application directory, and secrets supplied by the host secret manager. Multiple API and worker instances are supported; database compare-and-set leases serialize jobs. During a rolling deployment, apply backward-compatible migrations before replacing processes.

Webhook routes:

- Business: `TELEGRAM_BUSINESS_WEBHOOK_PATH`
- Admin: `TELEGRAM_ADMIN_WEBHOOK_PATH`

Both require Telegram’s `X-Telegram-Bot-Api-Secret-Token`. `/health/live` verifies the process. `/health/ready` checks MySQL, Qdrant, required configuration, and expected webhook URLs (or accepted local polling mode).

## Mini App authentication and management

The server verifies Telegram Mini App `initData` with the Admin Bot token and rejects stale or modified payloads. Only an active MySQL `Admin` can exchange it for an opaque, hashed server-side session. The browser receives an `HttpOnly`, `Secure`, host-only cookie; mutating API requests additionally require a rotated CSRF token and an idempotency key. The UI never stores tokens in browser storage.

Every record lookup is scoped to an active `AdminBusinessAccount` assignment. `SUPPORT` can inspect conversations and operate handoffs; `ADMIN` adds knowledge, audit, and diagnostics; `OWNER` adds authorization and safe settings visibility. Secrets, raw credentials, full provider balances, and low-level processing error details are not returned to support users.

The Persian RTL interface includes responsive mobile/desktop navigation, Telegram theme and safe-area integration, loading/empty/error states, searchable and filterable handoffs/conversations/knowledge, draft editing and preview, confirmation for destructive actions, handoff lifecycle actions, connection/health diagnostics, notifications, audit history, and owner-only admin management.

## Business AI availability

`تنظیمات ← زمان‌بندی پاسخ‌گویی هوشمند` is the only management surface for AI availability. The Admin Bot has no enable/disable command or callback.

- Each business has a master switch, an explicit IANA timezone, and a seven-day schedule. Defaults are enabled, `BUSINESS_DEFAULT_TIMEZONE` (`Asia/Tehran` by default), and 24/7 availability.
- Schedule values are business-local wall-clock times, evaluated with IANA timezone and daylight-saving rules independently of the server and administrator browser. Intervals are half-open: start inclusive and end exclusive.
- Overnight intervals are explicit: `06:00–01:00` runs from 06:00 through 01:00 the following day. Invalid and same-day/cross-day overlapping intervals are rejected.
- Precedence is master switch, working hours, conversation human mode, connection/can-reply permission, then Telegram reply window. Every condition must allow the response.
- The current outside-hours policy is explicit `SILENT`: store the message, skip retrieval/embeddings/model/send, create no automatic handoff, and do not queue delayed processing.
- Workers read MySQL before AI work and immediately before every AI send. A mid-generation disable suppresses sending as a successful non-retry outcome.
- Re-enabling applies only to new messages. It never processes skipped messages, proactively contacts customers, or changes existing conversation modes.
- `OWNER` and `ADMIN` can view and edit; `SUPPORT` is read-only. Mutations require session authentication, CSRF, idempotency, tenant assignment, and optimistic settings versioning.
- Master, hours, and timezone changes plus suppressed responses are written to `AuditLog` with business/correlation context and without full customer text. Operational health includes current availability, next transition, and suppression/change counts.

The authenticated, business-scoped endpoints are `GET/PUT /api/v1/businesses/:businessId/ai-settings` and `GET /api/v1/businesses/:businessId/ai-availability`. The weekly schedule is JSON because the UI and API version and replace the whole week atomically. Future date-specific closures and temporary overrides can be separate higher-precedence records without changing the recurring base schedule.

## Knowledge administration

The Persian Mini App supports add, list/view, search, draft-based title/description editing, preview, publish, enable/disable, confirmed soft deletion, indexing status, and failed-index retry. Drafts are durable `KnowledgeDraft` records with optimistic revision checks, so restarts do not lose work and stale tabs cannot silently overwrite newer edits. Every publish or knowledge mutation stores MySQL first and creates the durable indexing job in the same transaction.

Indexing splits descriptions at paragraph/sentence boundaries with overlap, embeds every chunk, performs idempotent deterministic Qdrant upserts, removes obsolete versions, and marks MySQL `READY`. Temporary errors use bounded exponential retry; terminal failures become `FAILED` and notify administrators.

To rebuild the complete Qdrant index from active MySQL knowledge during a maintenance window (pause the normal worker first):

```bash
npm run qdrant:reindex
```

This recreates only the configured Qdrant collection, queues every active current MySQL version, processes the durable jobs, and exits non-zero if any active item fails. It never deletes MySQL knowledge.

## Human handoff and the two 24-hour mechanisms

These mechanisms are independent:

1. **Application human mode:** a handoff moves a conversation to `HUMAN` until `humanModeExpiresAt`, normally 24 hours. AI is silent. The durable worker atomically returns expired conversations to `AI`, marks the handoff `EXPIRED`, audits, and notifies admins. It sends no customer message. **Enable AI Now** resolves immediately; **Keep Human for Another 24 Hours** sets expiry to 24 hours from the button press.
2. **Telegram Business reply window:** the bot may send/edit on behalf of the account only when that private customer chat received an incoming message in the preceding 24 hours. `lastCustomerMessageAt` and `telegramReplyWindowExpiresAt` are tracked, but Telegram’s API response is final. An expiry rejection is recorded and not continuously retried. A new customer message reopens the window. The human account owner may still reply manually according to Telegram client capabilities.

Handoff notifications contain only a concise Persian summary and one **مشاهده جزئیات** button. Customer identity, recent context, reason/timestamps, remaining windows, claim/resolve controls, and the optional `https://t.me/<username>` navigation live inside the authenticated Mini App. Telegram notification buttons never change system state.

By default, handoff only notifies administrators and sends nothing to the customer. Set `HANDOFF_CUSTOMER_MESSAGE_ENABLED=true` to restore the optional acknowledgement using `HANDOFF_CUSTOMER_MESSAGE`.

Outgoing `business_message` updates with `sender_business_bot` are stored as `AI`; outgoing messages from the business account without that marker are `HUMAN`. Neither is queued as a customer question. Manual human replies do not trigger an AI answer and do not themselves change human-mode expiry.

## Roles

- `OWNER`: all features, including authorization management.
- `ADMIN`: knowledge, handoffs, modes, status, and audit.
- `SUPPORT`: handoff/status/context operations; access is scoped by business-account assignment.

Access is checked against active MySQL records, not an in-memory list. The seed environment is only the bootstrap path.

## Scripts

| Command                                   | Purpose                                                      |
| ----------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                             | React Mini App with hot reload plus watch-mode API           |
| `npm run dev:api`                         | Watch-mode API only; polling and worker follow configuration |
| `npm run dev:web`                         | Vite Mini App only, with `/api` proxied to port 3000         |
| `npm run build` / `npm run start`         | Compile strict TypeScript and run production JS              |
| `npm run worker` / `npm run worker:start` | Development TS worker / compiled production worker           |
| `npm run typecheck`                       | Strict no-emit TypeScript validation                         |
| `npm run lint`                            | Type-aware ESLint                                            |
| `npm run format` / `format:check`         | Prettier write/check                                         |
| `npm run test` / `test:coverage`          | Mocked unit tests / V8 coverage                              |
| `npm run prisma:generate`                 | Generate Prisma client                                       |
| `npm run prisma:migrate`                  | Deploy checked-in MySQL migrations                           |
| `npm run prisma:seed`                     | Bootstrap business account and admins                        |
| `npm run qdrant:init` / `qdrant:reindex`  | Initialize or fully rebuild the vector index                 |
| `npm run telegram:set-webhooks`           | Configure both HTTPS webhooks and allowed update types       |
| `npm run telegram:delete-webhooks`        | Delete both webhooks without dropping pending updates        |
| `npm run check`                           | Format check, lint, typecheck, tests, and production build   |

## Backup and recovery

- Take encrypted, tested MySQL full backups plus binlog/PITR backups appropriate to your RPO. Back up before migrations and test restores into an isolated database.
- Store application configuration/secrets in a separate secret manager with version history; never put them in database dumps or Git.
- Qdrant snapshots are useful for faster recovery but are not authoritative. After a lost/corrupt index, run `qdrant:reindex` from restored MySQL.
- Telegram does not replay arbitrarily old updates. MySQL message/audit retention and backups are therefore part of the support record.
- To rotate a bot token, revoke it in BotFather, update the secret manager, restart the applicable process, and set that webhook again. Rotate one bot at a time.

## Security notes

- The service never authenticates a user account and never stores phone/OTP/MTProto sessions.
- Structured logs redact tokens, authorization/webhook headers, API keys, and message text unless `LOG_PERSONAL_DATA=true`; leave it false in production.
- Fastify limits bodies, applies security headers, rate-limits webhook routes, validates update shapes, uses correlation IDs, and returns sanitized errors.
- Telegram IDs use MySQL `BIGINT` and TypeScript `bigint`; numeric JSON values must pass a safe-integer check before conversion.
- All database operations are parameterized through Prisma except the constant `SELECT 1` health probe.
- Customer input and knowledge are not trusted as model instructions. Do not put secrets in knowledge descriptions.
- Restrict database/Qdrant/NanoGPT egress and credentials to the API/worker hosts. Limit Mini App access by MySQL role and business assignment; do not treat Telegram UI visibility as authorization.
- Review retention, data-processing agreements, regional requirements, and user notice/consent for NanoGPT, Telegram, Qdrant, and backups before production use.

## Troubleshooting

- **`BOT_BUSINESS_MISSING` / business connection not allowed:** enable Business/Secretary Mode for the Business Bot in BotFather, then disconnect/reconnect it in the support account.
- **Connection disabled:** the support account revoked, paused, or changed the connection. The latest `business_connection` update sets `enabled=false`; reconnect in Telegram. AI will remain blocked until an enabled update arrives.
- **Missing `can_reply`:** reconnect or edit the connection and grant only Reply. The Mini App connection screen shows the persisted status.
- **`can_read_messages` error:** keep `TELEGRAM_MARK_READ=false`, or explicitly grant Read messages. Reply permission alone is sufficient for normal operation.
- **24-hour rejection:** wait for a new customer message; do not repeatedly retry. The human owner can open the normal account chat and respond manually.
- **Webhook receives nothing:** confirm public HTTPS, exact `PUBLIC_BASE_URL`, reverse-proxy path, firewall, and `npm run telegram:set-webhooks`; inspect `/health/ready` and Bot API webhook info.
- **Webhook `401`:** set a different exact secret for each route and rerun the webhook command after changing it.
- **Qdrant dimension mismatch:** the collection was created for another embedding configuration. Pause workers, verify the model/dimensions, then run `qdrant:reindex`.
- **Knowledge remains `FAILED`:** inspect structured worker logs by knowledge/job ID, repair credentials/network/input, then use **تلاش دوباره** inside the Mini App.
- **Mini App login fails:** open it from the Admin Bot, verify `MINI_APP_URL` is the deployed HTTPS origin, confirm the user is active and assigned to a business, and check that the server clock is synchronized.
- **No direct customer link:** Telegram usernames are optional. Use the identity in the authenticated handoff detail to find the chat in the support account.

## Credentials you must provide

- `DATABASE_URL`
- `TELEGRAM_BUSINESS_BOT_TOKEN`
- `TELEGRAM_ADMIN_BOT_TOKEN`
- two separate webhook secrets
- `TELEGRAM_OWNER_ID` (and optional initial IDs)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, chat model, embedding model/dimension
- `QDRANT_URL`, API key if required, and collection name
- production `PUBLIC_BASE_URL`
- production `MINI_APP_URL` when it differs from the default `${PUBLIC_BASE_URL}/mini-app`

The test suite requires none of these real credentials; all external NanoGPT, Telegram, and Qdrant behavior is mocked or tested through typed ports.
