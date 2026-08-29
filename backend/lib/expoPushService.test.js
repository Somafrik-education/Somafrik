"use strict";

const assert = require("node:assert/strict");
const { createExpoPushService } = require("./expoPushService");

async function main() {
  const revoked = [];
  const store = {
    async revokeByToken(token) {
      revoked.push(token);
      return { id: `rev-${revoked.length}` };
    },
  };

  let sendCalls = 0;
  const fetchImpl = async (url, init) => {
    sendCalls += 1;
    const body = JSON.parse(init.body);
    if (String(url).includes("getReceipts")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: {} });
        },
      };
    }
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

  const service = createExpoPushService({ fetchImpl, store, sendUrl: "http://expo.test/send", receiptsUrl: "http://expo.test/receipts" });
  const result = await service.sendToTokens(["ExponentPushToken[dead]"], {
    title: "Test Somafrik",
    body: "Les notifications push Somafrik fonctionnent correctement.",
    data: { somafrikDestination: "Home" },
  });
  assert.equal(sendCalls, 2, "retry temporaire puis succès");
  assert.deepEqual(revoked, ["ExponentPushToken[dead]"]);
  assert.equal(result.revoked.length, 1);
  assert.equal(result.sent, 1);

  console.log("expoPushService.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
