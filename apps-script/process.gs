/* ============================================================
 * STANDALONE SHOPIFY WEBHOOK EXTRACTION SCRIPT
 *
 * This code does NOT receive webhooks.
 * It only reads previously stored webhook JSON payloads.
 * ============================================================
 */

const CONFIG = {
  SOURCE_SHEET_NAME: "Shopify Webhooks",
  DESTINATION_SHEET_NAME: "Extracted Shopify Orders",

  // Maximum source webhook rows checked per execution.
  MAX_SOURCE_ROWS_PER_RUN: 500,
};


/* ============================================================
 * DESTINATION HEADERS
 * ============================================================
 */

const HEADERS = [
  // Internal extraction tracking
  "Extraction Key",
  "Source Row",
  "Webhook ID",
  "Event ID",
  "Webhook Topic",
  "Shop",
  "Webhook Triggered At",
  "API Version",

  // Order information
  "Order ID (gid)",
  "Order Name",
  "Created At",
  "Customer First Name",
  "Customer Last Name",
  "Customer Order Index",
  "Publication Name",
  "Payment Mode",
  "Financial Status",
  "Fulfillment Status",

  // Order values
  "Subtotal (current)",
  "Shipping (current)",
  "Tax Amount",
  "Discount",
  "Order Total",
  "Outstanding Amount",
  "Tax Currency",

  // Product information
  "Line Item ID (gid)",
  "Product ID (gid)",
  "Variant ID (gid)",
  "Product Handle",
  "Product Title",
  "Variant Title",
  "Custom Product Type",
  "Vendor",
  "Variant SKU",
  "Variant Price",
  "Variant Compare at Price",
  "Quantity",
  "Unit Cost",
  "Line Item Discount",

  // Landing page and attribution
  "Landing Page URL",
  "Landing Page Path",
  "Landing Page Query",
  "Referring Site",
  "Referring Domain",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "UTM Term",
  "UTM Content",
  "Google Click ID (gclid)",
  "Facebook Click ID (fbclid)",
  "Microsoft Click ID (msclkid)",
  "TikTok Click ID (ttclid)",
  "Attribution Source",
  "Attribution Channel",

  // Shopify and GoKwik source information
  "Shopify Source Name",
  "Shopify Source Identifier",
  "Shopify Source URL",
  "Shopify App ID",
  "GoKwik CID",
  "Cart Token",
  "Checkout Token",

  // Customer/contact information
  "Customer Email",
  "Customer Phone",
  "Shipping City",
  "Shipping Province",
  "Shipping Zip",
  "Shipping Country",

  // Fulfillment location
  "Fulfillment Location City",
  "Fulfillment Location Province",
  "Fulfillment Location Zip",

  // Technical attribution information
  "Customer IP",
  "User Agent",

  //Cancelled Date
  "Cancelled At",
];


/* ============================================================
 * MAIN EXTRACTION FUNCTION
 * ============================================================
 */

/**
 * Run this function manually to extract webhook payloads.
 *
 * Reads from:
 *   SOURCE_SPREADSHEET_ID
 *
 * Writes to:
 *   DESTINATION_SPREADSHEET_ID
 */
function extractShopifyWebhookData() {
  const properties =
    PropertiesService.getScriptProperties();

  const sourceSpreadsheetId =
    properties.getProperty(
      "SOURCE_SPREADSHEET_ID",
    );

  const destinationSpreadsheetId =
    properties.getProperty(
      "DESTINATION_SPREADSHEET_ID",
    );

  if (!sourceSpreadsheetId) {
    throw new Error(
      "Missing SOURCE_SPREADSHEET_ID in Script Properties.",
    );
  }

  if (!destinationSpreadsheetId) {
    throw new Error(
      "Missing DESTINATION_SPREADSHEET_ID in Script Properties.",
    );
  }

  if (
    sourceSpreadsheetId ===
    destinationSpreadsheetId
  ) {
    throw new Error(
      "Source and destination spreadsheet IDs must be different.",
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sourceSpreadsheet =
      SpreadsheetApp.openById(
        sourceSpreadsheetId,
      );

    const destinationSpreadsheet =
      SpreadsheetApp.openById(
        destinationSpreadsheetId,
      );

    const sourceSheet =
      sourceSpreadsheet.getSheetByName(
        CONFIG.SOURCE_SHEET_NAME,
      );

    if (!sourceSheet) {
      throw new Error(
        'Source sheet "' +
          CONFIG.SOURCE_SHEET_NAME +
          '" was not found.',
      );
    }

    const destinationSheet =
      getOrCreateSheet_(
        destinationSpreadsheet,
        CONFIG.DESTINATION_SHEET_NAME,
      );

    ensureHeaders_(
      destinationSheet,
      HEADERS,
    );

    const sourceLastRow =
      sourceSheet.getLastRow();

    if (sourceLastRow <= 1) {
      const emptyResult = {
        sourceRowsChecked: 0,
        productRowsCreated: 0,
        duplicateRowsSkipped: 0,
        nonOrderRowsSkipped: 0,
        errors: 0,
      };

      console.log(
        JSON.stringify(emptyResult),
      );

      return emptyResult;
    }

    /*
     * Read columns A:H:
     *
     * A Received At
     * B Webhook ID
     * C Event ID
     * D Topic
     * E Shop
     * F Triggered At
     * G API Version
     * H Payload
     */
    const totalSourceRows =
      sourceLastRow - 1;

    const rowsToRead = Math.min(
      totalSourceRows,
      CONFIG.MAX_SOURCE_ROWS_PER_RUN,
    );

    /*
     * This version reads the latest webhook rows first.
     */
    const startingSourceRow =
      sourceLastRow - rowsToRead + 1;

    const sourceRows =
      sourceSheet
        .getRange(
          startingSourceRow,
          1,
          rowsToRead,
          8,
        )
        .getValues();

    const existingExtractionKeys =
      getExistingExtractionKeys_(
        destinationSheet,
      );

    const rowsToWrite = [];

    const summary = {
      sourceRowsChecked: sourceRows.length,
      productRowsCreated: 0,
      duplicateRowsSkipped: 0,
      nonOrderRowsSkipped: 0,
      errors: 0,
    };

    sourceRows.forEach(
      function (sourceRow, index) {
        const actualSourceRow =
          startingSourceRow + index;

        try {
          const metadata = {
            receivedAt: sourceRow[0],
            webhookId: sourceRow[1],
            eventId: sourceRow[2],
            topic: sourceRow[3],
            shop: sourceRow[4],
            triggeredAt: sourceRow[5],
            apiVersion: sourceRow[6],
          };

          const payloadCell = sourceRow[7];

          if (
            payloadCell === null ||
            payloadCell === undefined ||
            payloadCell === ""
          ) {
            summary.nonOrderRowsSkipped++;
            return;
          }

          const payload =
            parsePayload_(
              payloadCell,
            );

          if (!isShopifyOrderPayload_(payload)) {
            summary.nonOrderRowsSkipped++;
            return;
          }

          const extractedRows =
            buildProductLevelRows_(
              payload,
              metadata,
              actualSourceRow,
            );

          extractedRows.forEach(
            function (extractedRow) {
              const extractionKey =
                String(extractedRow[0]);

              if (
                existingExtractionKeys.has(
                  extractionKey,
                )
              ) {
                summary
                  .duplicateRowsSkipped++;

                return;
              }

              rowsToWrite.push(
                extractedRow,
              );

              existingExtractionKeys.add(
                extractionKey,
              );

              summary.productRowsCreated++;
            },
          );
        } catch (error) {
          summary.errors++;

          console.error(
            "Error processing source row " +
              actualSourceRow +
              ": " +
              (
                error &&
                error.message
                  ? error.message
                  : String(error)
              ),
          );
        }
      },
    );

    if (rowsToWrite.length > 0) {
      const destinationStartRow =
        destinationSheet.getLastRow() + 1;

      destinationSheet
        .getRange(
          destinationStartRow,
          1,
          rowsToWrite.length,
          HEADERS.length,
        )
        .setValues(rowsToWrite);
    }

    console.log(
      JSON.stringify(summary),
    );

    return summary;
  } finally {
    lock.releaseLock();
  }
}


/* ============================================================
 * PRODUCT-LEVEL EXTRACTION
 * ============================================================
 */

/**
 * Converts an order payload into one row per line item.
 *
 * Attribution information is repeated for every product row.
 */
function buildProductLevelRows_(
  order,
  metadata,
  sourceRowNumber,
) {
  const lineItems =
    Array.isArray(order.line_items)
      ? order.line_items
      : [];

  const noteAttributes =
    getNoteAttributes_(
      order.note_attributes,
    );

  const attribution =
    getAttributionData_(
      order,
      noteAttributes,
    );

  const customer = order.customer || {};
  const shippingAddress =
    order.shipping_address || {};
  const billingAddress =
    order.billing_address || {};

  const orderGid =
    order.admin_graphql_api_id ||
    createShopifyGid_(
      "Order",
      order.id,
    );

  const customerFirstName =
    cleanCustomerName_(
      customer.first_name,
    ) ||
    shippingAddress.first_name ||
    billingAddress.first_name ||
    "";

  const customerLastName =
    cleanCustomerName_(
      customer.last_name,
    ) ||
    shippingAddress.last_name ||
    billingAddress.last_name ||
    "";

  const customerOrderIndex =
    firstAvailable_(
      noteAttributes.deliver_order_count,
      customer.orders_count,
    );

  const shippingLocation =
    getFulfillmentLocation_(order);

  const subtotal = toNumber_(
    firstAvailable_(
      order.current_subtotal_price,
      order.subtotal_price,
    ),
  );

  const shipping = toNumber_(
    firstAvailable_(
      getNestedValue_(
        order,
        "current_shipping_price_set.shop_money.amount",
      ),
      getNestedValue_(
        order,
        "total_shipping_price_set.shop_money.amount",
      ),
    ),
  );

  const taxAmount = toNumber_(
    firstAvailable_(
      order.current_total_tax,
      order.total_tax,
    ),
  );

  const discount = toNumber_(
    firstAvailable_(
      order.current_total_discounts,
      order.total_discounts,
    ),
  );

  const orderTotal = toNumber_(
    firstAvailable_(
      order.current_total_price,
      order.total_price,
    ),
  );

  const outstandingAmount =
    toNumber_(
      order.total_outstanding,
    );

  const currency =
    firstAvailable_(
      getNestedValue_(
        order,
        "current_total_tax_set.shop_money.currency_code",
      ),
      getNestedValue_(
        order,
        "total_price_set.shop_money.currency_code",
      ),
      order.currency,
      order.presentment_currency,
    ) || "";

  return lineItems.map(
    function (lineItem, lineIndex) {
      const lineItemIdentifier =
        firstAvailable_(
          lineItem.admin_graphql_api_id,
          lineItem.id,
          lineIndex,
        );

      /*
       * The extraction key prevents processing the same
       * webhook line item more than once.
       */
      const extractionKey = [
        metadata.webhookId ||
          metadata.eventId ||
          sourceRowNumber,

        orderGid ||
          order.id ||
          order.order_number,

        lineItemIdentifier,
      ].join("|");

      const lineItemGid =
        lineItem.admin_graphql_api_id ||
        createShopifyGid_(
          "LineItem",
          lineItem.id,
        );

      const productGid =
        lineItem
          .product_admin_graphql_api_id ||
        createShopifyGid_(
          "Product",
          lineItem.product_id,
        );

      const variantGid =
        lineItem
          .variant_admin_graphql_api_id ||
        createShopifyGid_(
          "ProductVariant",
          lineItem.variant_id,
        );

      const compareAtPrice =
        firstAvailable_(
          lineItem.compare_at_price,
          lineItem
            .variant_compare_at_price,
          getNestedValue_(
            lineItem,
            "compare_at_price_set.shop_money.amount",
          ),
        );

      const unitCost =
        firstAvailable_(
          getNestedValue_(
            lineItem,
            "unit_cost.amount",
          ),
          getNestedValue_(
            lineItem,
            "cost.amount",
          ),
          getNestedValue_(
            lineItem,
            "unit_cost_set.shop_money.amount",
          ),
          lineItem.unit_cost,
        );

      return sanitizeRow_([
        // Extraction tracking
        extractionKey,
        sourceRowNumber,
        metadata.webhookId || "",
        metadata.eventId || "",
        metadata.topic || "",
        metadata.shop || "",
        metadata.triggeredAt || "",
        metadata.apiVersion || "",

        // Order information
        orderGid,
        order.name ||
          order.order_number ||
          "",
        order.created_at || "",
        customerFirstName,
        customerLastName,
        toNumber_(customerOrderIndex),
        order.publication_name || "",
        getPaymentMode_(order),
        order.financial_status || "",
        order.fulfillment_status || "",

        // Order values
        subtotal,
        shipping,
        taxAmount,
        discount,
        orderTotal,
        outstandingAmount,
        currency,

        // Product information
        lineItemGid,
        productGid,
        variantGid,

        lineItem.product_handle ||
          lineItem.handle ||
          "",

        lineItem.title ||
          lineItem.name ||
          "",

        lineItem.variant_title || "",

        lineItem.custom_product_type ||
          lineItem.product_type ||
          "",

        lineItem.vendor || "",
        lineItem.sku || "",
        toNumber_(lineItem.price),
        toNumber_(compareAtPrice),
        toNumber_(lineItem.quantity),
        toNumber_(unitCost),
        toNumber_(
          lineItem.total_discount,
        ),

        // Attribution
        attribution.landingPageUrl,
        attribution.landingPagePath,
        attribution.landingPageQuery,
        attribution.referringSite,
        attribution.referringDomain,
        attribution.utmSource,
        attribution.utmMedium,
        attribution.utmCampaign,
        attribution.utmTerm,
        attribution.utmContent,
        attribution.gclid,
        attribution.fbclid,
        attribution.msclkid,
        attribution.ttclid,
        attribution.attributionSource,
        attribution.attributionChannel,

        // Shopify/GoKwik information
        order.source_name || "",
        order.source_identifier || "",
        order.source_url || "",
        order.app_id || "",
        noteAttributes.gokwik_cid || "",

        order.cart_token ||
          noteAttributes.cart_token ||
          "",

        order.checkout_token || "",

        // Customer information
        order.email ||
          customer.email ||
          "",

        order.phone ||
          customer.phone ||
          shippingAddress.phone ||
          "",

        shippingAddress.city || "",
        shippingAddress.province || "",
        shippingAddress.zip || "",
        shippingAddress.country || "",

        // Fulfillment location
        shippingLocation.city,
        shippingLocation.province,
        shippingLocation.zip,

        // Technical attribution
        noteAttributes.customer_ip || "",
        noteAttributes.user_agent || "",

        order.cancelled_at || "",
      ]);
    },
  );
}


/* ============================================================
 * ATTRIBUTION
 * ============================================================
 */

function getAttributionData_(
  order,
  noteAttributes,
) {
  const landingPageUrl =
    firstAvailable_(
      order.landing_site,
      noteAttributes.landing_site,
      noteAttributes.landing_page,
      noteAttributes.landing_page_url,
      noteAttributes.full_url,
    ) || "";

  const referringSite =
    firstAvailable_(
      order.referring_site,
      order.landing_site_ref,
      noteAttributes.referring_site,
      noteAttributes.referrer,
      noteAttributes.referer,
    ) || "";

  const urlParameters =
    parseUrlParameters_(
      landingPageUrl,
    );

  const utmSource =
    firstAvailable_(
      noteAttributes.utm_source,
      urlParameters.utm_source,
    ) || "";

  const utmMedium =
    firstAvailable_(
      noteAttributes.utm_medium,
      urlParameters.utm_medium,
    ) || "";

  const utmCampaign =
    firstAvailable_(
      noteAttributes.utm_campaign,
      urlParameters.utm_campaign,
    ) || "";

  const utmTerm =
    firstAvailable_(
      noteAttributes.utm_term,
      urlParameters.utm_term,
    ) || "";

  const utmContent =
    firstAvailable_(
      noteAttributes.utm_content,
      urlParameters.utm_content,
    ) || "";

  const gclid =
    firstAvailable_(
      noteAttributes.gclid,
      urlParameters.gclid,
    ) || "";

  const fbclid =
    firstAvailable_(
      noteAttributes.fbclid,
      urlParameters.fbclid,
    ) || "";

  const msclkid =
    firstAvailable_(
      noteAttributes.msclkid,
      urlParameters.msclkid,
    ) || "";

  const ttclid =
    firstAvailable_(
      noteAttributes.ttclid,
      urlParameters.ttclid,
    ) || "";

  const referringDomain =
    extractDomain_(referringSite);

  const attributionSource =
    determineAttributionSource_({
      utmSource: utmSource,
      referringDomain: referringDomain,
      gclid: gclid,
      fbclid: fbclid,
      msclkid: msclkid,
      ttclid: ttclid,
    });

  const attributionChannel =
    determineAttributionChannel_({
      attributionSource:
        attributionSource,
      utmMedium: utmMedium,
      referringSite: referringSite,
      referringDomain:
        referringDomain,
      gclid: gclid,
      fbclid: fbclid,
      msclkid: msclkid,
      ttclid: ttclid,
    });

  return {
    landingPageUrl: landingPageUrl,
    landingPagePath:
      extractUrlPath_(landingPageUrl),
    landingPageQuery:
      extractUrlQuery_(landingPageUrl),

    referringSite: referringSite,
    referringDomain: referringDomain,

    utmSource: utmSource,
    utmMedium: utmMedium,
    utmCampaign: utmCampaign,
    utmTerm: utmTerm,
    utmContent: utmContent,

    gclid: gclid,
    fbclid: fbclid,
    msclkid: msclkid,
    ttclid: ttclid,

    attributionSource:
      attributionSource,

    attributionChannel:
      attributionChannel,
  };
}


function determineAttributionSource_(data) {
  if (data.utmSource) {
    return data.utmSource;
  }

  if (data.gclid) {
    return "google";
  }

  if (data.fbclid) {
    return "facebook";
  }

  if (data.msclkid) {
    return "microsoft";
  }

  if (data.ttclid) {
    return "tiktok";
  }

  if (data.referringDomain) {
    return data.referringDomain;
  }

  return "direct";
}


function determineAttributionChannel_(data) {
  const source = String(
    data.attributionSource || "",
  )
    .trim()
    .toLowerCase();

  const medium = String(
    data.utmMedium || "",
  )
    .trim()
    .toLowerCase();

  const referrer = String(
    data.referringDomain || "",
  )
    .trim()
    .toLowerCase();

  if (
    source === "direct" ||
    source === "(direct)" ||
    medium === "none" ||
    medium === "(none)"
  ) {
    return "Direct";
  }

  if (data.fbclid || data.ttclid) {
    return "Paid Social";
  }

  if (data.gclid || data.msclkid) {
    return "Paid Search";
  }

  if (
    containsAny_(medium, [
      "paid_social",
      "paid-social",
      "social_paid",
    ])
  ) {
    return "Paid Social";
  }

  if (
    containsAny_(medium, [
      "cpc",
      "ppc",
      "paid_search",
      "paid-search",
    ])
  ) {
    return "Paid Search";
  }

  if (
    containsAny_(medium, [
      "display",
      "banner",
      "programmatic",
    ])
  ) {
    return "Display Advertising";
  }

  if (
    containsAny_(medium, [
      "email",
      "newsletter",
    ]) ||
    containsAny_(source, [
      "email",
      "newsletter",
      "klaviyo",
      "mailchimp",
    ])
  ) {
    return "Email";
  }

  if (
    containsAny_(medium, [
      "affiliate",
    ])
  ) {
    return "Affiliate";
  }

  if (
    containsAny_(medium, [
      "sms",
      "whatsapp",
    ])
  ) {
    return "Messaging";
  }

  const socialSources = [
    "facebook",
    "instagram",
    "linkedin",
    "twitter",
    "x.com",
    "youtube",
    "pinterest",
    "snapchat",
    "tiktok",
    "reddit",
    "threads.net",
  ];

  if (
    containsAny_(source, socialSources) ||
    containsAny_(referrer, socialSources)
  ) {
    return "Organic Social";
  }

  const searchEngines = [
    "google",
    "bing",
    "yahoo",
    "duckduckgo",
    "baidu",
    "yandex",
  ];

  if (
    containsAny_(source, searchEngines) ||
    containsAny_(
      referrer,
      searchEngines,
    )
  ) {
    return "Organic Search";
  }

  if (
    data.referringSite ||
    data.referringDomain
  ) {
    return "Referral";
  }

  return "Campaign";
}


/* ============================================================
 * AUTOMATIC TRIGGER
 * ============================================================
 */

/**
 * Run once manually to automatically extract data every 5 minutes.
 */
function setupExtractionTrigger() {
  removeExtractionTrigger();

  ScriptApp
    .newTrigger(
      "extractShopifyWebhookData",
    )
    .timeBased()
    .everyMinutes(5)
    .create();
}


/**
 * Removes existing extraction triggers.
 */
function removeExtractionTrigger() {
  ScriptApp
    .getProjectTriggers()
    .forEach(function (trigger) {
      if (
        trigger.getHandlerFunction() ===
        "extractShopifyWebhookData"
      ) {
        ScriptApp.deleteTrigger(
          trigger,
        );
      }
    });
}


/* ============================================================
 * SHEET HELPERS
 * ============================================================
 */

function getOrCreateSheet_(
  spreadsheet,
  sheetName,
) {
  let sheet =
    spreadsheet.getSheetByName(
      sheetName,
    );

  if (!sheet) {
    sheet =
      spreadsheet.insertSheet(
        sheetName,
      );
  }

  return sheet;
}


function ensureHeaders_(
  sheet,
  headers,
) {
  if (
    sheet.getMaxColumns() <
    headers.length
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length -
        sheet.getMaxColumns(),
    );
  }

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length,
    )
    .setValues([headers])
    .setFontWeight("bold");

  sheet.setFrozenRows(1);
}


/**
 * Reads existing Extraction Keys from destination column A.
 */
function getExistingExtractionKeys_(
  sheet,
) {
  const keys = new Set();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return keys;
  }

  const existingValues =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1,
      )
      .getDisplayValues();

  existingValues.forEach(
    function (row) {
      const key =
        String(row[0] || "").trim();

      if (key) {
        keys.add(key);
      }
    },
  );

  return keys;
}


/* ============================================================
 * PAYMENT AND FULFILLMENT
 * ============================================================
 */

function getPaymentMode_(order) {
  const gateways =
    Array.isArray(
      order.payment_gateway_names,
    )
      ? order.payment_gateway_names
          .filter(Boolean)
      : [];

  if (gateways.length > 0) {
    return gateways.join(", ");
  }

  const tags = String(order.tags || "")
    .split(",")
    .map(function (tag) {
      return tag
        .trim()
        .toUpperCase();
    });

  if (tags.indexOf("COD") !== -1) {
    return "COD";
  }

  const shippingLines =
    Array.isArray(order.shipping_lines)
      ? order.shipping_lines
      : [];

  const hasCodCharge =
    shippingLines.some(
      function (shippingLine) {
        const title = String(
          shippingLine.title || "",
        ).toUpperCase();

        const code = String(
          shippingLine.code || "",
        ).toUpperCase();

        return (
          title.indexOf("COD") !== -1 ||
          code.indexOf("COD") !== -1
        );
      },
    );

  if (hasCodCharge) {
    return "COD";
  }

  if (
    String(
      order.financial_status || "",
    ).toLowerCase() === "paid"
  ) {
    return "Prepaid";
  }

  return "";
}


function getFulfillmentLocation_(order) {
  const fulfillments =
    Array.isArray(order.fulfillments)
      ? order.fulfillments
      : [];

  const fulfillment =
    fulfillments.length > 0
      ? fulfillments[0]
      : {};

  const location =
    fulfillment.origin_address ||
    fulfillment.assigned_location ||
    fulfillment.location ||
    {};

  return {
    city: location.city || "",

    province:
      location.province ||
      location.province_code ||
      "",

    zip:
      location.zip ||
      location.postal_code ||
      "",
  };
}


/* ============================================================
 * JSON AND OBJECT HELPERS
 * ============================================================
 */

function parsePayload_(payloadCell) {
  if (
    typeof payloadCell === "object" &&
    payloadCell !== null
  ) {
    return payloadCell;
  }

  const payloadText =
    String(payloadCell || "").trim();

  if (!payloadText) {
    throw new Error(
      "Payload is empty.",
    );
  }

  return JSON.parse(payloadText);
}


function isShopifyOrderPayload_(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (
        payload.id ||
        payload.admin_graphql_api_id
      ) &&
      Array.isArray(payload.line_items),
  );
}


function getNoteAttributes_(
  noteAttributes,
) {
  const result = {};

  if (!Array.isArray(noteAttributes)) {
    return result;
  }

  noteAttributes.forEach(
    function (attribute) {
      if (
        !attribute ||
        attribute.name === undefined
      ) {
        return;
      }

      const key = String(
        attribute.name,
      )
        .trim()
        .toLowerCase();

      result[key] = attribute.value;
    },
  );

  return result;
}


function getNestedValue_(
  object,
  path,
) {
  return String(path)
    .split(".")
    .reduce(
      function (current, key) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== "object"
        ) {
          return undefined;
        }

        return current[key];
      },
      object,
    );
}


function firstAvailable_() {
  for (
    let index = 0;
    index < arguments.length;
    index++
  ) {
    const value =
      arguments[index];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return "";
}


function createShopifyGid_(
  resourceType,
  numericId,
) {
  if (
    numericId === undefined ||
    numericId === null ||
    numericId === ""
  ) {
    return "";
  }

  return (
    "gid://shopify/" +
    resourceType +
    "/" +
    String(numericId)
  );
}


function toNumber_(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }

  if (
    typeof value === "object" &&
    value.amount !== undefined
  ) {
    value = value.amount;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : "";
}


function cleanCustomerName_(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/^[^a-zA-Z0-9]+/, "")
    .trim();
}


function sanitizeRow_(row) {
  return row.map(function (value) {
    if (typeof value !== "string") {
      return value;
    }

    const firstCharacter =
      value.trim().charAt(0);

    if (
      firstCharacter === "=" ||
      firstCharacter === "+" ||
      firstCharacter === "-" ||
      firstCharacter === "@"
    ) {
      return "'" + value;
    }

    return value;
  });
}


function containsAny_(
  value,
  terms,
) {
  const normalized =
    String(value || "")
      .toLowerCase();

  return terms.some(
    function (term) {
      return (
        normalized.indexOf(
          String(term).toLowerCase(),
        ) !== -1
      );
    },
  );
}


/* ============================================================
 * URL HELPERS
 * ============================================================
 */

function parseUrlParameters_(url) {
  const parameters = {};

  if (
    !url ||
    String(url).indexOf("?") === -1
  ) {
    return parameters;
  }

  try {
    const queryString = String(url)
      .split("?")[1]
      .split("#")[0];

    queryString
      .split("&")
      .forEach(function (pair) {
        if (!pair) {
          return;
        }

        const parts = pair.split("=");

        const key =
          safeDecodeURIComponent_(
            parts[0] || "",
          )
            .trim()
            .toLowerCase();

        const value =
          safeDecodeURIComponent_(
            parts.slice(1).join("=") ||
              "",
          ).trim();

        if (key) {
          parameters[key] = value;
        }
      });
  } catch (error) {
    console.warn(
      "Could not parse URL: " + url,
    );
  }

  return parameters;
}


function extractDomain_(url) {
  if (!url) {
    return "";
  }

  const value =
    String(url).trim();

  if (value.charAt(0) === "/") {
    return "";
  }

  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .toLowerCase();
}


function extractUrlPath_(url) {
  if (!url) {
    return "";
  }

  const value =
    String(url).trim();

  if (value.charAt(0) === "/") {
    return (
      value
        .split("?")[0]
        .split("#")[0] ||
      "/"
    );
  }

  const withoutProtocol =
    value
      .replace(/^https?:\/\//i, "")
      .replace(/^\/\//, "");

  const slashIndex =
    withoutProtocol.indexOf("/");

  if (slashIndex === -1) {
    return "/";
  }

  return (
    withoutProtocol
      .substring(slashIndex)
      .split("?")[0]
      .split("#")[0] ||
    "/"
  );
}


function extractUrlQuery_(url) {
  if (
    !url ||
    String(url).indexOf("?") === -1
  ) {
    return "";
  }

  return String(url)
    .split("?")[1]
    .split("#")[0];
}


function safeDecodeURIComponent_(
  value,
) {
  try {
    return decodeURIComponent(
      String(value || "")
        .replace(/\+/g, " "),
    );
  } catch (error) {
    return String(value || "");
  }
}
