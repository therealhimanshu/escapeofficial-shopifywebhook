const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "shopify-webhook-relay",
      });
    }

    if (
      request.method !== "POST" ||
      url.pathname !== "/webhooks/shopify"
    ) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    /*
     * Read the unchanged request body before parsing JSON.
     * Shopify calculates its signature from these exact bytes.
     */
    const rawBody = await request.arrayBuffer();

    const receivedHmac = request.headers.get(
      "x-shopify-hmac-sha256",
    );

    const validHmac = await verifyShopifyHmac(
      rawBody,
      receivedHmac,
      env.SHOPIFY_WEBHOOK_SECRET,
    );

    if (!validHmac) {
      console.warn("Invalid Shopify webhook signature");

      return jsonResponse(
        { error: "Invalid Shopify signature" },
        401,
      );
    }

    const shopDomain = normalizeShop(
      request.headers.get("x-shopify-shop-domain"),
    );

    const expectedShop = normalizeShop(env.SHOPIFY_SHOP);

    if (
      expectedShop &&
      shopDomain !== expectedShop
    ) {
      console.warn("Unexpected Shopify store:", shopDomain);

      return jsonResponse(
        { error: "Unexpected Shopify store" },
        403,
      );
    }

    let shopifyPayload;

    try {
      shopifyPayload = JSON.parse(
        decoder.decode(rawBody),
      );
    } catch {
      return jsonResponse(
        { error: "Invalid JSON body" },
        400,
      );
    }

    const outgoingPayload = {
      /*
       * This authenticates Cloudflare to Apps Script.
       * It is unrelated to Shopify API credentials.
       */
      relay_secret: env.APPS_SCRIPT_SHARED_SECRET,

      received_at: new Date().toISOString(),

      webhook: {
        id:
          request.headers.get(
            "x-shopify-webhook-id",
          ) || "",

        event_id:
          request.headers.get(
            "x-shopify-event-id",
          ) || "",

        topic:
          request.headers.get(
            "x-shopify-topic",
          ) || "",

        shop: shopDomain,

        api_version:
          request.headers.get(
            "x-shopify-api-version",
          ) || "",

        triggered_at:
          request.headers.get(
            "x-shopify-triggered-at",
          ) || "",
      },

      payload: shopifyPayload,
    };

    try {
      const appsScriptResult =
        await sendToAppsScript(
          outgoingPayload,
          env,
        );

      return jsonResponse({
        ok: true,
        forwarded: true,
        apps_script: appsScriptResult,
      });
    } catch (error) {
      /*
       * Returning a non-2xx response allows Shopify to treat
       * this delivery as unsuccessful.
       */
      console.error(
        "Apps Script forwarding failed:",
        error,
      );

      return jsonResponse(
        {
          error: "Apps Script forwarding failed",
        },
        502,
      );
    }
  },
};

async function verifyShopifyHmac(
  rawBody,
  receivedHmac,
  sharedSecret,
) {
  if (!receivedHmac || !sharedSecret) {
    return false;
  }

  try {
    const signatureBytes = Uint8Array.from(
      atob(receivedHmac),
      (character) => character.charCodeAt(0),
    );

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(sharedSecret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      rawBody,
    );
  } catch (error) {
    console.error(
      "Shopify HMAC verification error:",
      error,
    );

    return false;
  }
}

async function sendToAppsScript(payload, env) {
  const response = await fetch(
    env.APPS_SCRIPT_WEB_APP_URL,
    {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Apps Script returned HTTP ${response.status}: ` +
      responseText.slice(0, 500),
    );
  }

  let responseJson;

  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Apps Script did not return valid JSON: " +
      responseText.slice(0, 500),
    );
  }

  if (responseJson.ok !== true) {
    throw new Error(
      "Apps Script rejected the payload: " +
      JSON.stringify(responseJson),
    );
  }

  return responseJson;
}

function normalizeShop(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function jsonResponse(body, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}