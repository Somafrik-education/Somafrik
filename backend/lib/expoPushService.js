"use strict";

const DEFAULT_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEFAULT_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function createExpoPushService({
  fetchImpl = globalThis.fetch.bind(globalThis),
  store,
  sendUrl = process.env.EXPO_PUSH_SEND_URL || DEFAULT_PUSH_URL,
  receiptsUrl = process.env.EXPO_PUSH_RECEIPTS_URL || DEFAULT_RECEIPTS_URL,
  now = () => Date.now(),
} = {}) {
  async function requestJson(url, body, attempt = 1) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      return requestJson(url, body, attempt + 1);
    }
    if (!response.ok) {
      const error = new Error(`Expo Push HTTP ${response.status}`);
      error.statusCode = response.status;
      error.details = data;
      error.retryable = isRetryableStatus(response.status);
      throw error;
    }
    return data;
  }

  async function revokeUnregistered(tokens) {
    const revoked = [];
    for (const token of tokens) {
      if (typeof store?.revokeByToken === "function") {
        const row = await store.revokeByToken(token);
        if (row?.id) revoked.push(row.id);
      }
    }
    return revoked;
  }

  function collectUnregistered(tickets, tokens) {
    const lost = [];
    const list = Array.isArray(tickets) ? tickets : [];
    list.forEach((ticket, index) => {
      const details = ticket?.details || ticket?.message || "";
      const error = ticket?.details?.error || ticket?.error;
      if (ticket?.status === "error" && String(error) === "DeviceNotRegistered") {
        lost.push(tokens[index]);
      }
      if (typeof details === "string" && /DeviceNotRegistered/i.test(details)) {
        lost.push(tokens[index]);
      }
    });
    return [...new Set(lost.filter(Boolean))];
  }

  async function fetchReceipts(ids) {
    const unique = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!unique.length) return {};
    const data = await requestJson(receiptsUrl, { ids: unique });
    const receiptMap = data?.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
    return receiptMap;
  }

  async function sendToTokens(tokens, message) {
    const unique = [...new Set((tokens || []).map((token) => String(token || "").trim()).filter(Boolean))];
    if (!unique.length) {
      return { sent: 0, ticketCount: 0, revoked: [], pendingReceipts: [] };
    }
    const payload = unique.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data || {},
      sound: "default",
      channelId: message.channelId || "somafrik-default",
      priority: "default",
    }));
    const data = await requestJson(sendUrl, payload);
    const tickets = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const unregistered = collectUnregistered(tickets, unique);
    const pendingReceipts = [];
    tickets.forEach((ticket, index) => {
      const receiptId = String(ticket?.id ?? "").trim();
      if (ticket?.status === "ok" && receiptId) {
        pendingReceipts.push({ receiptId, expoPushToken: unique[index] });
      }
    });
    // Les receipts Expo ne sont PAS consultés ici : ticket ≠ livraison.
    if (pendingReceipts.length && typeof store?.enqueuePushReceipts === "function") {
      await store.enqueuePushReceipts(pendingReceipts, { now: now() });
    }
    const revoked = await revokeUnregistered([...new Set(unregistered)]);
    return {
      sent: unique.length,
      ticketCount: tickets.length,
      revoked,
      pendingReceipts,
      at: now(),
    };
  }

  return { sendToTokens, fetchReceipts };
}

module.exports = {
  createExpoPushService,
  DEFAULT_PUSH_URL,
  DEFAULT_RECEIPTS_URL,
};
