/**
 * NFC-REG-01 — continuité du lecteur NFC pendant une session de pointage.
 *
 * Le faux NfcManager reproduit le comportement de react-native-nfc-manager 4.0.0-beta.10
 * (Android) : requestTechnology active le mode lecteur via registerTagEvent quand aucun
 * enregistrement n'existe, et cancelTechnologyRequest le désactive alors (unregisterTagEvent).
 * Hors mode lecteur, Android distribue la carte présente aux autres applications
 * (NDEF_DISCOVERED) : c'est la fenêtre qui ouvrait une application externe.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { scanNfcCardToken, releaseNfcSession, type NfcHardware } from "./studentCardNfc";
import { createRollCallNfcLoop } from "./studentCardRollCall";

/** Options attendues du mode lecteur (android.nfc.NfcAdapter.FLAG_READER_NFC_A|B|F|V). */
const READER_MODE_OPTIONS = { isReaderModeEnabled: true, readerModeFlags: 0x1 | 0x2 | 0x4 | 0x8 };

const TOKEN_A = `${"A".repeat(22)}.${"B".repeat(43)}`;
const TOKEN_B = `${"C".repeat(22)}.${"D".repeat(43)}`;

function textRecord(text: string) {
  const lang = "en";
  return { tnf: 1, type: [0x54], payload: [lang.length, ...Array.from(lang + text).map((c) => c.charCodeAt(0))] };
}
function uriRecord(uri: string) {
  return { tnf: 1, type: [0x55], payload: [0x04, ...Array.from(uri).map((c) => c.charCodeAt(0))] };
}
const somafrikCard = (token: string) => ({ id: `04${token.slice(0, 4)}`, ndefMessage: [textRecord(`somafrik:card:${token}`)] });
const urlCard = { id: "04URL", ndefMessage: [uriRecord("example.org/app")] };
const blankCard = { id: "04BLANK", techTypes: ["android.nfc.tech.NfcA"] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

/** Faux module natif + journal de ce qu'Android ferait d'une carte présentée. */
function fakeAndroidNfc() {
  const state = {
    readerMode: false,
    autoRegistered: false,
    pending: null as null | { resolve: (tech: string) => void; reject: (error: Error) => void },
    tag: null as unknown,
    registers: 0,
    unregisters: 0,
    cancels: 0,
    externalDispatches: [] as unknown[],
  };
  const manager = {
    start: async () => {},
    isSupported: async () => true,
    isEnabled: async () => true,
    registerTagEvent: async (options: unknown) => {
      assert.deepEqual(options, READER_MODE_OPTIONS);
      state.registers += 1;
      state.readerMode = true;
    },
    unregisterTagEvent: async () => {
      state.unregisters += 1;
      state.readerMode = false;
      state.autoRegistered = false;
    },
    requestTechnology: (_techs: unknown, options: unknown) => {
      if (state.pending) return Promise.reject(new Error("You can only issue one request at a time"));
      if (!state.readerMode) {
        // Comportement de la bibliothèque : enregistrement implicite, nettoyé à l'annulation.
        assert.deepEqual(options, READER_MODE_OPTIONS);
        state.readerMode = true;
        state.autoRegistered = true;
      }
      return new Promise<string>((resolve, reject) => { state.pending = { resolve, reject }; });
    },
    cancelTechnologyRequest: async () => {
      state.cancels += 1;
      const pending = state.pending;
      state.pending = null;
      pending?.reject(new Error("cancelled"));
      if (state.autoRegistered) {
        state.readerMode = false;
        state.autoRegistered = false;
      }
    },
    getTag: async () => state.tag,
  };
  /** Une carte arrive dans le champ : lecteur Somafrik si actif, sinon distribution Android. */
  function present(tag: unknown) {
    state.tag = tag;
    if (!state.readerMode) {
      state.externalDispatches.push(tag);
      return;
    }
    const pending = state.pending;
    if (pending) {
      state.pending = null;
      pending.resolve("Ndef");
    }
  }
  return { state, manager, present };
}

/**
 * Charge le VRAI adaptateur natif (studentCardNfcNative + gestionnaire partagé nfcSessionNative)
 * avec react-native / react-native-nfc-manager simulés, instance neuve par test.
 */
function setup() {
  const android = fakeAndroidNfc();
  const require = createRequire(import.meta.url);
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const original = loader._load;
  for (const file of ["./studentCardNfcNative", "./nfcSessionNative"]) delete require.cache[require.resolve(file)];
  loader._load = function (request: unknown, ...rest: unknown[]) {
    if (request === "react-native") return { Platform: { OS: "android" } };
    if (request === "react-native-nfc-manager") return {
      __esModule: true,
      default: android.manager,
      NfcAdapter: { FLAG_READER_NFC_A: 0x1, FLAG_READER_NFC_B: 0x2, FLAG_READER_NFC_F: 0x4, FLAG_READER_NFC_V: 0x8 },
      NfcTech: { Ndef: "Ndef", NfcA: "NfcA", NfcB: "NfcB", IsoDep: "IsoDep", MifareUltralight: "MifareUltralight", NdefFormatable: "NdefFormatable" },
    };
    return original.call(this, request, ...rest);
  };
  let native: { createReactNativeNfcAdapter: () => NfcHardware };
  try {
    native = require("./studentCardNfcNative");
  } finally {
    loader._load = original;
  }
  return { android, reader: () => native.createReactNativeNfcAdapter() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await tick();
  assert.ok(condition(), "condition jamais atteinte");
}

test("dix scans successifs avec attente réseau : mode lecteur actif en continu, aucune distribution Android", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  const network: { resolve: (value: unknown) => void }[] = [];
  const seen: string[] = [];
  const loop = createRollCallNfcLoop({
    read: () => scanNfcCardToken(hardware),
    submit: async (token) => {
      seen.push(token);
      // Attente réseau lente : pendant ce temps une carte reste posée / une autre arrive.
      assert.equal(android.state.readerMode, true, "mode lecteur actif pendant l'attente réseau");
      android.present(somafrikCard(TOKEN_B));
      await new Promise((resolve) => network.push({ resolve }));
      return { stop: false };
    },
    onFeedback: () => {},
    onListening: () => {},
  });
  loop.start();
  for (let i = 0; i < 10; i++) {
    await waitFor(() => android.state.pending !== null);
    android.present(somafrikCard(i % 2 ? TOKEN_A : TOKEN_B));
    await waitFor(() => network.length === i + 1);
    network[i].resolve(undefined);
  }
  await waitFor(() => android.state.pending !== null);
  assert.equal(seen.length, 10);
  assert.deepEqual(android.state.externalDispatches, [], "aucune carte confiée à une autre application");
  assert.equal(android.state.registers, 1, "mode lecteur activé une seule fois pour la session");
  assert.equal(android.state.unregisters, 0, "jamais désactivé entre deux cartes");
  loop.stop();
  await releaseNfcSession(hardware);
  assert.equal(android.state.readerMode, false, "fermeture : mode lecteur libéré");
  assert.equal(android.state.unregisters, 1);
});

test("même carte présentée plusieurs fois : lue à chaque passage, aucune distribution externe", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  for (let i = 0; i < 3; i++) {
    const read = scanNfcCardToken(hardware);
    await waitFor(() => android.state.pending !== null);
    android.present(somafrikCard(TOKEN_A));
    assert.deepEqual(await read, { ok: true, token: TOKEN_A });
    // Carte encore posée après la lecture (réponse réseau en attente).
    android.present(somafrikCard(TOKEN_A));
  }
  assert.deepEqual(android.state.externalDispatches, []);
  await releaseNfcSession(hardware);
});

test("réseau indisponible : la lecture suivante ne rouvre aucune fenêtre Android", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  const offline: number[] = [];
  const loop = createRollCallNfcLoop({
    read: () => scanNfcCardToken(hardware),
    submit: async () => {
      // Comme les composants : l'échec réseau est attrapé et affiché, la boucle continue.
      android.present(somafrikCard(TOKEN_A));
      const failure = await Promise.reject(Object.assign(new Error("offline"), { status: 0 })).catch((error) => error);
      offline.push(failure.status);
      return { stop: false };
    },
    onFeedback: () => {},
    onListening: () => {},
  });
  loop.start();
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_A));
  await waitFor(() => offline.length === 1 && android.state.pending !== null);
  assert.equal(android.state.readerMode, true, "lecteur réarmé après l'échec réseau");
  loop.stop();
  await releaseNfcSession(hardware);
  assert.deepEqual(android.state.externalDispatches, []);
});

test("carte avec enregistrement URL ou carte inconnue : refusée, jamais ouverte, lecteur conservé", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  for (const [card, reason] of [[urlCard, "invalid_prefix"], [blankCard, "uid_only"]] as const) {
    const read = scanNfcCardToken(hardware);
    await waitFor(() => android.state.pending !== null);
    android.present(card);
    assert.deepEqual(await read, { ok: false, reason });
    android.present(card);
    assert.equal(android.state.readerMode, true);
  }
  assert.deepEqual(android.state.externalDispatches, []);
  await releaseNfcSession(hardware);
});

test("arrière-plan puis retour : libération complète, puis reprise avec un nouveau mode lecteur", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  const read = scanNfcCardToken(hardware);
  await waitFor(() => android.state.pending !== null);
  await releaseNfcSession(hardware); // AppState != active
  assert.deepEqual(await read, { ok: false, reason: "cancelled" });
  assert.equal(android.state.readerMode, false);
  // Le lecteur est rendu au gestionnaire partagé : un autre lecteur Somafrik peut le prendre.
  const other = reader();
  const otherRead = scanNfcCardToken(other);
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_B));
  assert.deepEqual(await otherRead, { ok: true, token: TOKEN_B });
  await releaseNfcSession(other);
  const again = scanNfcCardToken(hardware);
  await waitFor(() => android.state.pending !== null);
  assert.equal(android.state.readerMode, true);
  android.present(somafrikCard(TOKEN_A));
  assert.deepEqual(await again, { ok: true, token: TOKEN_A });
  await releaseNfcSession(hardware);
  assert.equal(android.state.readerMode, false);
});

test("fermeture du modal pendant une lecture : requête annulée, lecteur et bail libérés", async () => {
  const { android, reader } = setup();
  const hardware = reader();
  const read = scanNfcCardToken(hardware);
  await waitFor(() => android.state.pending !== null);
  await releaseNfcSession(hardware);
  assert.deepEqual(await read, { ok: false, reason: "cancelled" });
  assert.equal(android.state.pending, null);
  assert.equal(android.state.readerMode, false);
  assert.equal(android.state.unregisters, 1);
  const next = reader();
  const nextRead = scanNfcCardToken(next);
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_A));
  assert.deepEqual(await nextRead, { ok: true, token: TOKEN_A });
  await releaseNfcSession(next);
});

test("NFC désactivé avant lecture : aucun mode lecteur, bail rendu immédiatement", async () => {
  const { android, reader } = setup();
  android.manager.isEnabled = async () => false;
  assert.deepEqual(await scanNfcCardToken(reader()), { ok: false, reason: "disabled" });
  assert.equal(android.state.registers, 0);
  android.manager.isEnabled = async () => true;
  const other = reader();
  const read = scanNfcCardToken(other);
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_A));
  assert.deepEqual(await read, { ok: true, token: TOKEN_A });
  await releaseNfcSession(other);
});

test("deux lecteurs Somafrik : exclusivité conservée pendant toute la session, y compris entre deux cartes", async () => {
  const { android, reader } = setup();
  const first = reader();
  const second = reader();
  const read = scanNfcCardToken(first);
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_A));
  assert.deepEqual(await read, { ok: true, token: TOKEN_A });
  // Entre deux cartes (attente réseau), le second lecteur ne peut pas prendre la main.
  assert.deepEqual(await scanNfcCardToken(second), { ok: false, reason: "error" });
  assert.equal(android.state.readerMode, true, "le second lecteur n'a pas coupé le mode lecteur du premier");
  await releaseNfcSession(first);
  const handoff = scanNfcCardToken(second);
  await waitFor(() => android.state.pending !== null);
  android.present(somafrikCard(TOKEN_B));
  assert.deepEqual(await handoff, { ok: true, token: TOKEN_B });
  await releaseNfcSession(second);
  assert.equal(android.state.readerMode, false);
});

test("aucun module NFC Somafrik n'ouvre d'URL ni d'application à partir des données NFC", () => {
  for (const file of [
    "./studentCardNfc.ts",
    "./studentCardNfcNative.ts",
    "./nfcSession.ts",
    "./nfcSessionNative.ts",
    "./studentCardRollCall.ts",
    "../components/StudentCardNfcScannerModal.tsx",
    "../components/StudentCardRollCallModal.tsx",
    "../components/StudentCardVerifyModal.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Linking|openURL|canOpenURL|startActivity|IntentLauncher|WebBrowser/, file);
  }
  const native = readFileSync(new URL("./studentCardNfcNative.ts", import.meta.url), "utf8");
  assert.match(native, /registerTagEvent\(READER_MODE_OPTIONS\)/);
  assert.match(native, /unregisterTagEvent\(\)/);
  assert.match(native, /finishRead/);
});
