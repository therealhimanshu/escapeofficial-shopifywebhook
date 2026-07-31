function doPost(e) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty("RELAY_SECRET");
    const spreadsheetId = properties.getProperty("SHEET_ID");

    if (!expectedSecret || !spreadsheetId) {
      return jsonOutput_({ ok: false, error: "Missing script properties" });
    }

    const requestBody = JSON.parse(
      e.postData && e.postData.contents ? e.postData.contents : "{}",
    );

    if (requestBody.relay_secret !== expectedSecret) {
      return jsonOutput_({ ok: false, error: "Unauthorized" });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName("Shopify Webhooks");

    if (!sheet) sheet = spreadsheet.insertSheet("Shopify Webhooks");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Received At",
        "Webhook ID",
        "Event ID",
        "Topic",
        "Shop",
        "Triggered At",
        "API Version",
        "Payload",
      ]);
    }

    const webhook = requestBody.webhook || {};
    sheet.appendRow([
      requestBody.received_at || "",
      webhook.id || "",
      webhook.event_id || "",
      webhook.topic || "",
      webhook.shop || "",
      webhook.triggered_at || "",
      webhook.api_version || "",
      JSON.stringify(requestBody.payload || {}),
    ]);

    return jsonOutput_({
      ok: true,
      webhook_id: webhook.id || "",
      rows_written: 1,
    });
  } catch (error) {
    console.error(error);
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

function doGet() {
  return jsonOutput_({ ok: true, service: "Shopify webhook receiver" });
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
