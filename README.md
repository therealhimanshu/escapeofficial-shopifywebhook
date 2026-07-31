# Escape Official Shopify webhook relay

Receives Shopify webhooks in a Cloudflare Worker, verifies Shopify's HMAC
signature, and forwards the payload to Google Apps Script. Apps Script appends
the complete payload and webhook metadata to a Google Sheet.

## What you need

- The exact `*.myshopify.com` store domain (not the storefront/custom domain).
- The webhook signing value shown in Shopify Admin.
- The Google Sheet ID (the value between `/d/` and `/edit` in its URL).
- A deployed Apps Script Web App URL ending in `/exec`.
- Cloudflare and Google accounts with permission to deploy.

No Shopify Client ID, app client secret, Admin API access token, or installed
Shopify app is needed for this relay.

## 1. Configure Google Apps Script

1. Open the target spreadsheet, then **Extensions > Apps Script**.
2. Replace the editor contents with [`apps-script/Code.gs`](apps-script/Code.gs).
3. In **Project Settings > Script Properties**, add:
   - `SHEET_ID`: the target spreadsheet ID.
   - `RELAY_SECRET`: a new random secret. Generate one with
     `openssl rand -hex 32` and keep it for the Cloudflare step.
4. Choose **Deploy > New deployment > Web app**.
5. Set **Execute as** to yourself and access to **Anyone**. Deploy and copy the
   URL ending in `/exec`.

The script creates a `Shopify Webhooks` tab and its headers automatically.

## 2. Configure Cloudflare

Install dependencies:

```bash
npm install
```

Edit `wrangler.jsonc` and replace:

- `SHOPIFY_SHOP` with the exact `your-store.myshopify.com` domain.
- `APPS_SCRIPT_WEB_APP_URL` with the deployed `/exec` URL.

Store both secrets in Cloudflare (they are intentionally not in the config):

```bash
npx wrangler secret put SHOPIFY_WEBHOOK_SECRET
npx wrangler secret put APPS_SCRIPT_SHARED_SECRET
```

For the first command, paste Shopify Admin's webhook signing value. For the
second, paste the same random value used as Apps Script's `RELAY_SECRET`.

Deploy:

```bash
npm run deploy
```

The webhook URL is:

```text
https://escapeofficial-shopifywebhook.<your-subdomain>.workers.dev/webhooks/shopify
```

Check the Worker independently at:

```text
https://escapeofficial-shopifywebhook.<your-subdomain>.workers.dev/health
```

## 3. Configure Shopify

In Shopify Admin, create the desired webhook subscription and use the Worker
`/webhooks/shopify` URL as its destination. Choose JSON format. Do not use the
changing `X-Shopify-Hmac-Sha256` delivery header as the signing secret.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in local secrets, update the
non-secret values in `wrangler.jsonc`, then run:

```bash
npm run dev
npm test
```

Never commit `.dev.vars`; it is ignored by Git.
