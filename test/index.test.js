import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { verifyShopifyHmac } from "../src/index.js";

async function signedRequest(body, secret, headers = {}) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const hmac = Buffer.from(signature).toString("base64");

  return new Request("https://worker.test/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": "escapeofficial.myshopify.com",
      ...headers,
    },
    body,
  });
}

test("verifies a valid signature and rejects a changed body", async () => {
  const secret = "test-secret";
  const request = await signedRequest('{"id":1}', secret);
  const rawBody = await request.arrayBuffer();
  const hmac = request.headers.get("x-shopify-hmac-sha256");

  assert.equal(await verifyShopifyHmac(rawBody, hmac, secret), true);
  assert.equal(
    await verifyShopifyHmac(new TextEncoder().encode('{"id":2}'), hmac, secret),
    false,
  );
});

test("health endpoint responds without configuration", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("rejects an invalid Shopify signature", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/webhooks/shopify", {
      method: "POST",
      headers: { "x-shopify-hmac-sha256": "not-valid" },
      body: "{}",
    }),
    { SHOPIFY_WEBHOOK_SECRET: "secret" },
  );
  assert.equal(response.status, 401);
});

test("rejects a webhook from another store", async () => {
  const secret = "test-secret";
  const request = await signedRequest("{}", secret);
  const response = await worker.fetch(request, {
    SHOPIFY_WEBHOOK_SECRET: secret,
    SHOPIFY_SHOP: "another-store.myshopify.com",
  });
  assert.equal(response.status, 403);
});
