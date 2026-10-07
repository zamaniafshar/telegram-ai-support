# Deployment & Update Guide (Shared Host)

A concise, step-by-step guide to deploying, running, and updating **telegram-ai-support** on a shared host or VPS with low resources.

---

## 📋 Prerequisites

- **Node.js**: v20.19+, v22.13+, or v24+
- **MySQL**: 8.0+ or MariaDB 10.5+ (create an empty database & user first)
- **Domain**: An active HTTPS domain (Telegram webhooks strictly require HTTPS)
- **Process Manager**: PM2 (recommended) or your host's Node.js App Manager (cPanel / Passenger)

---

## 🚀 1. First-Time Setup & Deployment

Run these steps once when setting up the project on the server:

### Step 1: Clone or Upload Files

```bash
git clone <your-repo-url> app
cd app
```

### Step 2: Configure Environment Variables

Copy and configure `.env`:

```bash
cp .env.example .env
nano .env   # or edit via cPanel File Manager
```

> **Key Shared-Host Settings in `.env`:**
>
> - `NODE_ENV=production`
> - `TELEGRAM_TRANSPORT=webhook`
> - `PUBLIC_BASE_URL=https://yourdomain.com`
> - `RUN_WORKERS_IN_API=true` (runs API and worker in 1 process to save RAM)
> - `SYSTEM_LOG_DB_LEVEL=warn` (prevents database storage bloat)
> - Make sure `MINI_APP_DEV_ADMIN_ID` is **commented out / deleted**!

### Step 3: Install Dependencies

```bash
npm ci
```

### Step 4: Run Database Migrations

```bash
npm run prisma:migrate
```

### Step 5: Initialize Qdrant Collection

Creates and prepares the vector collection in Qdrant:

```bash
npm run qdrant:init
```

### Step 6: Register Telegram Webhooks

Registers your production HTTPS endpoint with Telegram:

```bash
npm run telegram:set-webhooks
```

### Step 7: Build Application

Compiles the TypeScript backend into `dist/` and builds the React Mini App into `web/dist/`:

```bash
npm run build
```

### Step 8: Start the Process

#### Option A: Using PM2 (Recommended)

```bash
pm2 start dist/main.js --name telegram-ai-support --max-memory-restart 300M
pm2 save
pm2 startup
```

#### Option B: Using cPanel "Setup Node.js App"

- **Application root**: `app` (your project directory)
- **Application startup file**: `dist/main.js`
- **Application mode**: `Production`
- Click **Run NPM Install**, then click **Restart**.

---

## 🔄 2. How to Update the Project on Host

Whenever you push new code or want to update the server, run this quick sequence:

```bash
# 1. Fetch latest changes
git pull origin main

# 2. Update dependencies (only if package.json changed)
npm ci

# 3. Apply any new database migrations
npm run prisma:migrate

# 4. Rebuild server and frontend
npm run build

# 5. Restart application
pm2 restart telegram-ai-support
```

### ⚡ One-Liner Update Command

You can run this all at once:

```bash
git pull && npm ci && npm run prisma:migrate && npm run build && pm2 restart telegram-ai-support
```

_(If using cPanel Node.js selector instead of PM2, click the **Restart** button in cPanel after running the build)._

---

## 🩺 3. Verification & Health Checks

Verify your deployment is running healthy:

1. **Check process status**:

   ```bash
   pm2 status
   pm2 logs telegram-ai-support --lines 50
   ```

2. **Check HTTP Health endpoints**:

   ```bash
   curl -i http://127.0.0.1:3000/health/live
   curl -i http://127.0.0.1:3000/health/ready
   ```

   Both should return HTTP `200` with `{"ready":true}`.

3. **Check Webhook URL**:
   Test in browser: `https://yourdomain.com/mini-app` (should display the login/dashboard screen).

---

## ⚠️ Important Troubleshooting on Low Resources

- **Out of Memory during `npm run build`**:
  If your host limits RAM during builds, build locally on your computer first (`npm run build`), then upload the compiled `dist/` and `web/dist/` folders to the host.
- **App crashes on startup with `MINI_APP_DEV_ADMIN_ID` error**:
  In `.env`, comment out `MINI_APP_DEV_ADMIN_ID` (it is strictly forbidden in `production`).
- **Telegram updates not arriving**:
  Re-run `npm run telegram:set-webhooks` to ensure Telegram has your exact public HTTPS domain and secret token.
