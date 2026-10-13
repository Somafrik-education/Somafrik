import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { createRequire } from "node:module";
import { createNfcSessionManager } from "./nfcSession";
import { scanNfcCardToken, extractNfcCardTokenFromTag } from "./studentCardNfc";
import { identifyNtag, ndefForCard, cardTokenFromNdef } from "./studentCardNfcEncoding";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("NTAG213 and NTAG216 encoder records round-trip through the same reader contract", () => {
  const require = createRequire(import.meta.url);
  const ndef = require("react-native-nfc-manager/dist/ndef-lib");
  const token = `${"A".repeat(22)}.${"B".repeat(43)}`;
  for (const [storage, model, capacity] of [[0x0f, "NTAG213", 144], [0x13, "NTAG216", 888]] as const) {
    const identity = identifyNtag("04112233445566", [0, 4, 4, 2, 1, 0, storage, 3]);
    assert.equal(identity.tagType, model);
    const text = ndefForCard(token);
    const bytes = ndef.encodeMessage([ndef.textRecord(text, "en")]);
    assert.ok(bytes.length + 3 <= capacity);
    assert.equal(cardTokenFromNdef(text), token);
    assert.deepEqual(extractNfcCardTokenFromTag({ id: identity.uid, ndefMessage: ndef.decodeMessage(bytes) }), { ok: true, token });
  }
});

test("reader and encoder cannot own the hardware together; startup is shared", async () => {
  let starts = 0;
  const manager = createNfcSessionManager({ start: async () => { starts++; }, cancel: async () => {} });
  const reader = manager.acquire();
  await reader.start();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  await reader.close();
  const encoder = manager.acquire();
  await encoder.start();
  assert.equal(starts, 1);
  await encoder.close();
});

test("handoff waits for native cancellation and discards a late discovery", async () => {
  const discovery = deferred<string>();
  const cancellation = deferred<void>();
  let cancels = 0;
  const manager = createNfcSessionManager({ start: async () => {}, cancel: async () => { cancels++; await cancellation.promise; } });
  const reader = manager.acquire();
  const result = reader.request(() => discovery.promise);
  const rejected = assert.rejects(result, { code: "NFC_SESSION_CANCELLED" });
  const closing = reader.close();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  let writeCalled = false;
  await assert.rejects(reader.run(async () => { writeCalled = true; }), { code: "NFC_SESSION_CANCELLED" });
  assert.equal(writeCalled, false);
  cancellation.resolve();
  await Promise.resolve();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  discovery.resolve("stale-tag");
  await rejected;
  await closing;
  const encoder = manager.acquire();
  await encoder.request(async () => "new-tag");
  await reader.close(); // Old effect cleanup cannot cancel the new owner's discovery.
  assert.equal(cancels, 1);
  await encoder.close();
  assert.equal(cancels, 2);
});

test("handoff also waits for in-flight reads/writes, not just discovery", async () => {
  const write = deferred<void>();
  const manager = createNfcSessionManager({ start: async () => {}, cancel: async () => {} });
  const encoder = manager.acquire();
  await encoder.request(async () => "tag");
  const writing = encoder.run(() => write.promise);
  const rejected = assert.rejects(writing, { code: "NFC_SESSION_CANCELLED" });
  const closing = encoder.close();
  await Promise.resolve();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  write.resolve();
  await rejected;
  await closing;
  await manager.acquire().close();
});

test("physical rediscovery after a write retains ownership until the encoder closes", async () => {
  let cancels = 0;
  const manager = createNfcSessionManager({ start: async () => {}, cancel: async () => { cancels++; } });
  const encoder = manager.acquire();
  await encoder.request(async () => "tag");
  await encoder.reset();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  await encoder.request(async () => "fresh-tag");
  await encoder.close();
  assert.equal(cancels, 2);
  await manager.acquire().close();
});

test("screen cancellation during rediscovery releases the owner and prevents another request", async () => {
  const cancellation = deferred<void>();
  const manager = createNfcSessionManager({ start: async () => {}, cancel: () => cancellation.promise });
  const encoder = manager.acquire();
  await encoder.request(async () => "tag");
  const resetting = encoder.reset();
  const rejected = assert.rejects(resetting, { code: "NFC_SESSION_CANCELLED" });
  const closing = encoder.close();
  cancellation.resolve();
  await rejected;
  await closing;
  await assert.rejects(encoder.request(async () => "must-not-discover"), { code: "NFC_SESSION_CANCELLED" });
  await manager.acquire().close();
});

test("native cancellation failure keeps hardware quarantined until a successful retry", async () => {
  let fails = true;
  const manager = createNfcSessionManager({ start: async () => {}, cancel: async () => { if (fails) throw new Error("native cancel failed"); } });
  const owner = manager.acquire();
  await owner.request(async () => "tag");
  await assert.rejects(owner.close(), /native cancel failed/);
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  await assert.rejects(owner.run(async () => "write"), { code: "NFC_SESSION_CANCELLED" });
  fails = false;
  await owner.close();
  await manager.acquire().close();
});

test("a cancelled late native discovery is reported as cancellation without resolving its tag", async () => {
  const discovery = deferred<void>();
  const requested = deferred<void>();
  const manager = createNfcSessionManager({ start: async () => {}, cancel: async () => { discovery.resolve(); } });
  const reader = manager.acquire();
  const result = scanNfcCardToken({
    start: () => reader.start(), isSupported: async () => true, isEnabled: async () => true,
    requestTag: () => reader.request(async () => { requested.resolve(); await discovery.promise; }),
    getTag: async () => { assert.fail("cancelled tag must not resolve"); }, cancel: () => reader.close(),
  });
  await requested.promise;
  await reader.close();
  assert.deepEqual(await result, { ok: false, reason: "cancelled" });
});

test("startup failure is retryable and cancellation during startup blocks stale work", async () => {
  let attempts = 0;
  const startup = deferred<void>();
  const manager = createNfcSessionManager({ start: async () => { if (++attempts === 1) throw new Error("startup failed"); await startup.promise; }, cancel: async () => { assert.fail("no discovery to cancel"); } });
  const first = manager.acquire();
  await assert.rejects(first.start(), /startup failed/);
  await first.close();
  const second = manager.acquire();
  const starting = second.start();
  const rejected = assert.rejects(starting, { code: "NFC_SESSION_CANCELLED" });
  const closing = second.close();
  assert.throws(() => manager.acquire(), { code: "NFC_SESSION_BUSY" });
  startup.resolve();
  await rejected;
  await closing;
  assert.equal(attempts, 2);
});

// Exercise the actual native facades with a mocked RN bridge, not a second implementation.
test("native reader and encoder share a lease and fail closed on isEnabled errors", async () => {
  const require = createRequire(import.meta.url);
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const original = loader._load;
  let enabledFails = true;
  let requests = 0;
  let cancels = 0;
  const discovery = deferred<string>();
  const native = {
    start: async () => {}, isSupported: async () => true,
    isEnabled: async () => { if (enabledFails) throw new Error("native enabled check failed"); return true; },
    requestTechnology: async () => { requests++; return discovery.promise; },
    cancelTechnologyRequest: async () => { cancels++; discovery.reject(new Error("cancelled")); },
    getTag: async () => ({ id: "04112233445566" }),
  };
  loader._load = function (request, parent, isMain) {
    if (request === "react-native") return { Platform: { OS: "android" } };
    if (request === "react-native-nfc-manager") return {
      __esModule: true, default: native, NfcAdapter: {},
      NfcTech: { Ndef: "Ndef", NfcA: "NfcA", NfcB: "NfcB", IsoDep: "IsoDep" }, Ndef: {}, NdefStatus: {},
    };
    return original.call(this, request, parent, isMain);
  };
  try {
    const { createReactNativeNfcAdapter } = require("./studentCardNfcNative");
    const { createNfcEncoderHardware } = require("./studentCardNfcEncoderNative");
    const reader = createReactNativeNfcAdapter();
    const encoder = createNfcEncoderHardware();
    assert.deepEqual(await scanNfcCardToken(reader), { ok: false, reason: "error" });
    assert.equal(requests, 0);
    await assert.rejects(encoder.inspect(), /native enabled check failed/);
    assert.equal(requests, 0);
    assert.equal(cancels, 0);
    enabledFails = false;
    await reader.isSupported();
    await reader.start();
    const pending = reader.requestTag();
    const rejected = assert.rejects(pending, /cancelled/);
    await assert.rejects(encoder.inspect(), { code: "NFC_SESSION_BUSY" });
    await encoder.close(); // Cannot release the reader's lease.
    assert.equal(cancels, 0);
    await reader.cancel();
    await rejected;
    assert.equal(cancels, 1);
  } finally {
    loader._load = original;
  }
});
