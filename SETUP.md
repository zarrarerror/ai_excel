# Shayntech Excel AI Pro — Setup Guide

## Architecture
```
Excel Add-in (addin/taskpane.html)
    ↓ HTTPS
Backend (backend/server.js on Replit)
    ↓                    ↓
Supabase (auth+DB)    Qwen/Alibaba (AI)
    ↓
LemonSqueezy (payments webhook)
```

---

## Step 1 — Supabase Setup

1. Go to https://supabase.com → New Project
2. Copy your **Project URL** and **service_role secret key** (Settings → API)
3. Go to SQL Editor → New Query → paste contents of `supabase/schema.sql` → Run

---

## Step 2 — LemonSqueezy Setup

1. Sign up at https://app.lemonsqueezy.com
2. Create a **Store** → create a **Product** (subscription, $8.99/month)
3. Copy your **Variant ID** from the product → build checkout URL:
   `https://YOUR-STORE.lemonsqueezy.com/checkout/buy/YOUR-VARIANT-ID`
4. Go to Settings → Webhooks → Add webhook:
   - URL: `https://YOUR-REPLIT-BACKEND.replit.app/api/webhook/lemonsqueezy`
   - Events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`, `order_created`
   - Copy the **Signing Secret**

---

## Step 3 — Deploy Backend on Replit

1. Create a new Replit project → import from GitHub (`zarrarerror/ai_excel`, folder `backend/`)
2. Add these **Secrets** (Replit → Tools → Secrets):

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `QWEN_API_KEY` | Your DashScope API key (sk-...) |
| `QWEN_API_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` |
| `QWEN_MODEL` | `qwen-max` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Your LemonSqueezy signing secret |
| `LEMONSQUEEZY_CHECKOUT_URL` | Your LemonSqueezy checkout URL |
| `FREE_USES_LIMIT` | `50` |
| `ADDIN_ORIGIN` | `https://excel-ai-pro-backend.replit.app` |

3. Run: `npm install && npm start`
4. Note your Replit URL: `https://YOUR-PROJECT.replit.app`

---

## Step 4 — Update Add-in with your Replit URL

In `addin/taskpane.html`, search for:
```
var PRO_BACKEND_URL = 'https://excel-ai-pro-backend.replit.app';
```
Replace with your actual Replit URL (appears **twice** in the file).

Also update `addin/manifest.xml` — replace all occurrences of:
```
https://excel-ai-pro-backend.replit.app
```
with your actual Replit URL.

---

## Step 5 — Serve the Add-in

Option A: Serve `addin/taskpane.html` from the **same Replit backend** (recommended)
- Add to `backend/server.js`:
  ```js
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../addin')));
  ```
- This way your add-in and backend share one Replit URL.

Option B: Use a separate Replit project just for the static add-in files.

---

## Step 6 — Install the Add-in

1. Copy `addin/manifest.xml` to `C:\ExcelAddins\`
2. Share that folder as a network share (right-click → Properties → Sharing)
3. Excel → File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs
4. Add: `\\localhost\ExcelAddins` → check "Show in Menu" → OK
5. Restart Excel → Insert → My Add-ins → Shared Folder → **Shayntech Excel AI Pro**

---

## Testing

- Register a new account in the add-in → should see "50 free left"
- Send a message → usage counter should decrease
- Send 50 messages → should see upgrade modal
- Simulate LemonSqueezy webhook with `is_pro: true` → pill should show "★ Pro"

---

## Arabic Support

The add-in automatically:
- Detects Arabic input and responds in Arabic
- Applies Right alignment to cells containing Arabic text
- Works with Qwen which has excellent Arabic language support
