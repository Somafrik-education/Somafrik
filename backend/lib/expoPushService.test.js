"use strict";

const assert = require("node:assert/strict");
const { createExpoPushService } = require("./expoPushService");

async function main() {
  const revoked = [];
  const queued = [];
  const store = {
    async revokeByToken(token) {
      revoked.push(token);
      return { id: `rev-${revoked.length}` };
    },
    async enqueuePushReceipts(items) {
      queued.push(...items);
      return items;
    },
  };

  let sendCalls = 0;
  let receiptCalls = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes("getReceipts")) {
      receiptCalls += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: {} });
        },
      };
    }
    sendCalls += 1;
    if (sendCalls === 1) {
      return { ok: false, status: 503, async text() { return "busy"; } };
    }
    const tokens = Array.isArray(body) ? body.map((item) => item.to) : [];
    assert.equal(tokens[0], "ExponentPushToken[dead]");
    assert.ok(!JSON.stringify(body).includes("jwt"));
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
        });
      },
    };
  };

  const service = createExpoPushService({
    fetchImpl,
    store,
    sendUrl: "http://expo.test/send",
    receiptsUrl: "http://expo.test/getReceipts",
  });
  const result = await service.sendToTokens(["ExponentPushToken[dead]"], {
    title: "Test Somafrik",
    body: "Les notifications push Somafrik fonctionnent correctement.",
    data: { somafrikDestination: "Home" },
  });
  assert.equal(sendCalls, 2, "retry temporaire puis succès");
  assert.equal(receiptCalls, 0, "aucun getReceipts immédiat");
  assert.deepEqual(revoked, ["ExponentPushToken[dead]"]);
  assert.equal(result.revoked.length, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.pendingReceipts, []);

  sendCalls = 0;
  const okFetch = async (url, init) => {
    if (String(url).includes("getReceipts")) {
      receiptCalls += 1;
      throw new Error("getReceipts ne doit pas être appelé au send");
    }
    sendCalls += 1;
    const body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [{ status: "ok", id: "ticket-ok-1" }],
        });
      },
    };
  };
  const okService = createExpoPushService({
    fetchImpl: okFetch,
    store,
    sendUrl: "http://expo.test/send",
    receiptsUrl: "http://expo.test/getReceipts",
  });
  const ok = await okService.sendToTokens(["ExponentPushToken[alive]"], {
    title: "Test Somafrik",
    body: "Les notifications push Somafrik fonctionnent correctement.",
  });
  assert.equal(ok.pendingReceipts[0].receiptId, "ticket-ok-1");
  assert.equal(queued[0].receiptId, "ticket-ok-1");
  assert.equal(receiptCalls, 0);

  console.log("expoPushService.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
