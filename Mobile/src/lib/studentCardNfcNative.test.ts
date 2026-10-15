/**
 * NFC-RECETTE-05 / RC-5 — cycle du Reader Mode Android pendant le scanner.
 * Exécute la vraie couche JS de react-native-nfc-manager et le vrai adaptateur
 * Somafrik ; seul le module natif est simulé, selon NfcManager.java 4.0.0-beta.10 :
 * registerTagEvent active le Reader Mode, unregisterTagEvent le coupe, et une carte
 * encore dans le champ quand il est coupé est redispatchée par Android
 * (com.android.apps.tag affiche alors le NDEF hors de Somafrik).
 */
import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

type Callback = (error: unknown, result?: unknown) => void;
type FakeTag = { id: string; techTypes: string[]; ndefMessage: unknown[] };

function createFakeNative() {
  const state = {
    registered: false,
    readerMode: false,
    techRequest: null as null | { callback: Callback; tag: FakeTag | null },
    inField: null as FakeTag | null,
    externalDispatches: [] as string[],
    registrations: 0,
  };
  function platformDispatch() {
    if (state.inField) state.externalDispatches.push("com.android.apps.tag");
  }
  function discover(tag: FakeTag) {
    if (state.registered && state.readerMode) {
      const request = state.techRequest;
      if (request && !request.tag) {
        request.tag = tag;
        request.callback(null, "Ndef");
      }
      return;
    }
    platformDispatch();
  }
  const native = {
    start: (cb: Callback) => cb(null),
    isSupported: (_tech: unknown, cb?: Callback) => (cb ?? (_tech as Callback))(null, true),
    isEnabled: (cb: Callback) => cb(null, true),
    hasTagEventRegistration: (cb: Callback) => cb(null, state.registered),
    registerTagEvent(options: { isReaderModeEnabled?: boolean }, cb: Callback) {
      state.registered = true;
      state.registrations += 1;
      state.readerMode = options.isReaderModeEnabled === true;
      cb(null);
    },
    unregisterTagEvent(cb: Callback) {
      const wasGuarding = state.registered && state.readerMode;
      state.registered = false;
      state.readerMode = false;
      // Android repart en interrogation normale : une carte maintenue est redécouverte.
      if (wasGuarding) platformDispatch();
      cb(null);
    },
    requestTechnology(_techs: unknown, _options: unknown, cb: Callback) {
      if (!state.registered) return cb("you should requestTagEvent first");
      if (state.techRequest) return cb("You can only issue one request at a time");
      state.techRequest = { callback: cb, tag: null };
      if (state.inField && state.readerMode) discover(state.inField);
    },
    cancelTechnologyRequest(cb: Callback) {
      const request = state.techRequest;
      state.techRequest = null;
      if (request && !request.tag) request.callback("cancelled");
      cb(null);
    },
    getTag(cb: Callback) {
      cb(null, state.techRequest?.tag ?? null);
    },
    addListener() {},
    removeListeners() {},
  };
  return {
    state,
    native,
    present(tag: FakeTag) {
      state.inField = tag;
      discover(tag);
    },
    remove() { state.inField = null; },
  };
}

const fake = createFakeNative();
const reactNativeStub = {
  Platform: { OS: "android", select: (choices: Record<string, unknown>) => choices.android ?? choices.default },
  NativeModules: { NfcManager: fake.native },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
};
const moduleApi = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = moduleApi._load;
moduleApi._load = function load(request: string, ...rest: unknown[]) {
  if (request === "react-native") return reactNativeStub;
  return originalLoad.call(this, request, ...rest);
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { createReactNativeNfcAdapter } = require("./studentCardNfcNative") as typeof import("./studentCardNfcNative");
const { scanNfcCardToken, endNfcReader } = require("./studentCardNfc") as typeof import("./studentCardNfc");
const { createNativeNfcSession } = require("./nfcSessionNative") as typeof import("./nfcSessionNative");
const NfcManager = require("react-native-nfc-manager").default as typeof import("react-native-nfc-manager").default;
/* eslint-enable @typescript-eslint/no-require-imports */

const TOKEN = `${"A".repeat(22)}.${"a".repeat(43)}`;
function card(token = TOKEN): FakeTag {
  const text = `somafrik:card:${token}`;
  return {
    id: "04112233445566",
    techTypes: ["android.nfc.tech.Ndef"],
    ndefMessage: [{ tnf: 1, type: [0x54], payload: [2, 0x65, 0x6e, ...Array.from(text, (c) => c.charCodeAt(0))] }],
  };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForRequest() {
  for (let i = 0; i < 100 && !fake.state.techRequest; i += 1) await sleep(1);
  assert.ok(fake.state.techRequest, "requestTechnology jamais émis");
}

test.beforeEach(() => {
  Object.assign(fake.state, { registered: false, readerMode: false, techRequest: null, inField: null, externalDispatches: [], registrations: 0 });
});

test("RC-5 : une carte maintenue après lecture n'est pas reprise par Android tant que le scanner est ouvert", async () => {
  const hardware = createReactNativeNfcAdapter();
  const pending = scanNfcCardToken(hardware, { timeoutMs: 5_000 });
  await waitForRequest();
  const presentedAt = Date.now();
  fake.present(card()); // l'enseignant garde la carte contre le téléphone
  assert.deepEqual(await pending, { ok: true, token: TOKEN });
  const releaseMs = Date.now() - presentedAt;

  await sleep(1_300); // au-delà du délai delayMsAndroid (1 s) de la bibliothèque
  assert.deepEqual(fake.state.externalDispatches, [], "Android a ouvert com.android.apps.tag pendant le scanner");
  assert.equal(fake.state.readerMode, true, "le Reader Mode doit protéger la carte tant que le scanner est ouvert");
  assert.ok(releaseMs < 500, `la lecture rend la main en ${releaseMs} ms (attente native de 1 s avant correction)`);

  await endNfcReader(hardware); // fermeture du scanner, une fois la carte retirée
  fake.remove();
  assert.equal(fake.state.registered, false, "fermeture : enregistrement natif libéré");
  assert.equal(fake.state.readerMode, false);
});

test("RC-5 : lectures successives et Réessayer sous un seul Reader Mode, sans lecture concurrente", async () => {
  const hardware = createReactNativeNfcAdapter();
  for (const token of [TOKEN, `${"B".repeat(22)}.${"b".repeat(43)}`]) {
    const pending = scanNfcCardToken(hardware, { timeoutMs: 5_000 });
    await waitForRequest();
    fake.present(card(token));
    assert.deepEqual(await pending, { ok: true, token });
    fake.remove();
  }
  const retry = scanNfcCardToken(hardware, { timeoutMs: 40 });
  assert.deepEqual(await retry, { ok: false, reason: "timeout" });
  assert.equal(fake.state.techRequest, null, "le timeout annule la requête native");
  assert.equal(fake.state.registrations, 1, "un seul enregistrement Reader Mode pour toute la session du scanner");
  assert.deepEqual(fake.state.externalDispatches, []);
  await endNfcReader(hardware);
  assert.equal(fake.state.registered, false);
});

test("RC-5 : la fermeture libère tout et l'encodeur reprend son propre cycle", async () => {
  const reader = createReactNativeNfcAdapter();
  const pending = scanNfcCardToken(reader, { timeoutMs: 5_000 });
  await waitForRequest();
  await endNfcReader(reader); // fermeture / changement de périmètre / arrière-plan pendant l'attente
  assert.equal((await pending).ok, false);
  assert.equal(fake.state.registered, false);
  assert.equal(fake.state.techRequest, null);

  const encoder = createNativeNfcSession();
  await encoder.start();
  const tech = encoder.request(() => NfcManager.requestTechnology(["Ndef"] as never, { isReaderModeEnabled: true }));
  await waitForRequest();
  fake.present(card());
  assert.equal(await tech, "Ndef");
  fake.remove();
  await encoder.close(); // la bibliothèque désinscrit elle-même son enregistrement
  assert.equal(fake.state.registered, false);
  assert.deepEqual(fake.state.externalDispatches, []);
});
