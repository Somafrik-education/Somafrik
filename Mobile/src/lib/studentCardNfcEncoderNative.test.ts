/**
 * NFC-RECETTE-06 / RC-6 — encodage NFC de bout en bout côté Mobile.
 * Vraie couche JS react-native-nfc-manager 4.0.0-beta.10, vrai adaptateur d'encodage et vrai
 * flux createIndividualNfcFlow ; seul le module natif est simulé, d'après NfcManager.java,
 * NdefHandler.java et TagTechnologyRequest.java (connexion à la 1re technologie demandée
 * supportée ; Reader Mode piloté par register/unregisterTagEvent ; une puce encore dans le
 * champ quand le Reader Mode est coupé est redistribuée par Android à com.android.apps.tag).
 */
import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";

type Callback = (error: unknown, result?: unknown) => void;
type NdefRecordLike = { tnf: number; type: number[]; payload: number[]; id?: number[] };
type FakeTag = {
  id: string;
  techs: string[];
  version: number[];
  records: NdefRecordLike[] | null;
  writable: boolean;
  maxSize: number;
};

const nodeRequire = createRequire(import.meta.url);
const ndefLib = nodeRequire("react-native-nfc-manager/dist/ndef-lib");

function createFakeNative() {
  const state = {
    registered: false,
    readerMode: false,
    registrations: 0,
    request: null as null | { techs: string[]; callback: Callback; tech: string | null; snapshot: NdefRecordLike[] | null },
    inField: null as FakeTag | null,
    consumed: false, // la puce présente a déjà été découverte en Reader Mode (pas de nouvelle découverte sans la retirer)
    externalDispatches: 0,
    writes: 0,
  };
  function connect(tag: FakeTag) {
    const request = state.request;
    if (!request || request.tech) return false;
    const tech = request.techs.find((candidate) => tag.techs.includes(candidate));
    if (!tech) return false;
    request.tech = tech;
    request.snapshot = tag.records ? tag.records.map((record) => ({ ...record })) : null;
    state.consumed = true;
    request.callback(null, tech);
    return true;
  }
  function discover() {
    const tag = state.inField;
    if (!tag) return;
    if (state.registered && state.readerMode) {
      if (!state.consumed) connect(tag);
      return;
    }
    state.externalDispatches += 1; // com.android.apps.tag
  }
  const connected = (tech: string) => {
    const request = state.request;
    if (!request?.tech || !state.inField) throw new Error("no tech request available");
    if (request.tech !== tech) throw new Error(`${tech} unavailable on ${request.tech}`);
    return request;
  };
  const native = {
    start: (cb: Callback) => cb(null),
    isSupported: (_tech: unknown, cb?: Callback) => (cb ?? (_tech as Callback))(null, true),
    isEnabled: (cb: Callback) => cb(null, true),
    hasTagEventRegistration: (cb: Callback) => cb(null, state.registered),
    registerTagEvent(options: { isReaderModeEnabled?: boolean }, cb: Callback) {
      state.registered = true;
      state.registrations += 1;
      state.readerMode = options.isReaderModeEnabled === true;
      state.consumed = false; // réactivation : Android interroge de nouveau la puce présente
      cb(null);
      discover();
    },
    unregisterTagEvent(cb: Callback) {
      const guarding = state.registered && state.readerMode;
      state.registered = false;
      state.readerMode = false;
      state.consumed = false;
      cb(null);
      if (guarding) discover();
    },
    requestTechnology(techs: string[], _options: unknown, cb: Callback) {
      if (!state.registered) return cb("you should requestTagEvent first");
      if (state.request) return cb("You can only issue one request at a time");
      state.request = { techs, callback: cb, tech: null, snapshot: null };
      if (state.inField && state.readerMode && !state.consumed) connect(state.inField);
    },
    cancelTechnologyRequest(cb: Callback) {
      const request = state.request;
      state.request = null;
      if (request && !request.tech) request.callback("cancelled");
      cb(null);
    },
    getTag(cb: Callback) {
      const tag = state.inField;
      cb(null, state.request?.tech && tag ? { id: tag.id, techTypes: tag.techs.map((t) => `android.nfc.tech.${t}`) } : null);
    },
    transceive(bytes: number[], cb: Callback) {
      try {
        connected("NfcA");
        if (bytes.length !== 1 || bytes[0] !== 0x60) return cb("unsupported command");
        cb(null, state.inField!.version);
      } catch (error) { cb(String(error)); }
    },
    getNdefMessage(cb: Callback) {
      try {
        const request = connected("Ndef");
        cb(null, { id: state.inField!.id, ndefMessage: request.snapshot });
      } catch (error) { cb(String(error)); }
    },
    queryNdefStatus(cb: Callback) {
      try {
        connected("Ndef");
        cb(null, { isWritable: state.inField!.writable, maxSize: state.inField!.maxSize, canMakeReadOnly: true });
      } catch (error) { cb(String(error)); }
    },
    writeNdefMessage(bytes: number[], _options: unknown, cb: Callback) {
      try {
        connected("Ndef");
        if (!state.inField!.writable) return cb("read only");
        // Android (Util.recordToJSON) renvoie type et payload en octets, jamais en chaîne.
        const asBytes = (value: unknown) => typeof value === "string"
          ? Array.from(value, (char) => char.charCodeAt(0))
          : Array.from(value as ArrayLike<number>);
        state.inField!.records = ndefLib.decodeMessage(bytes).map((record: { tnf: number; type: unknown; payload: unknown }) => ({
          tnf: record.tnf, type: asBytes(record.type), payload: asBytes(record.payload),
        }));
        state.writes += 1;
        cb(null);
      } catch (error) { cb(String(error)); }
    },
    addListener() {},
    removeListeners() {},
  };
  return {
    state,
    native,
    /** L'utilisateur pose la puce sur le téléphone. */
    present(tag: FakeTag) { state.inField = tag; state.consumed = false; discover(); },
    /** L'utilisateur retire la puce. */
    remove() { state.inField = null; state.consumed = false; },
  };
}

const fake = createFakeNative();
const moduleApi = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = moduleApi._load;
moduleApi._load = function load(request: string, ...rest: unknown[]) {
  if (request === "react-native") {
    return {
      Platform: { OS: "android", select: (choices: Record<string, unknown>) => choices.android ?? choices.default },
      NativeModules: { NfcManager: fake.native },
      NativeEventEmitter: class { addListener() { return { remove() {} }; } },
    };
  }
  return originalLoad.call(this, request, ...rest);
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { createNfcEncoderHardware } = require("./studentCardNfcEncoderNative") as typeof import("./studentCardNfcEncoderNative");
const { createIndividualNfcFlow } = require("./studentCardNfcEncoding") as typeof import("./studentCardNfcEncoding");
const { createNativeNfcSession } = require("./nfcSessionNative") as typeof import("./nfcSessionNative");
/* eslint-enable @typescript-eslint/no-require-imports */
type EnrollmentCard = import("./studentCardNfcEncoding").EnrollmentCard;
type NtagIdentity = import("./studentCardNfcEncoding").NtagIdentity;

const NTAG213 = [0, 4, 4, 2, 1, 0, 0x0f, 3];
const NTAG216 = [0, 4, 4, 2, 1, 0, 0x13, 3];
let uidCounter = 0x10;
function blankTag(model: "NTAG213" | "NTAG216" = "NTAG216", overrides: Partial<FakeTag> = {}): FakeTag {
  uidCounter += 1;
  return {
    id: `04AABBCCDD${uidCounter.toString(16).toUpperCase().padStart(2, "0")}${uidCounter % 10}0`.slice(0, 14),
    techs: ["NfcA", "MifareUltralight", "Ndef"],
    version: model === "NTAG213" ? NTAG213 : NTAG216,
    records: null, // NDEF formaté, sans message : « Tag vide » pour Android
    writable: true,
    maxSize: model === "NTAG213" ? 137 : 868,
    ...overrides,
  };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeApi() {
  let seq = 0;
  const cards = new Map<string, EnrollmentCard & { cardToken?: string }>();
  const calls = { issue: 0, confirm: 0, failNextConfirm: false };
  const token = (publicId: string) => `${publicId}.${"s".repeat(43)}`;
  return {
    calls,
    cards,
    api: {
      async list() { return { cards: [...cards.values()].map(({ cardToken: _t, ...card }) => card), nfcEnabled: true }; },
      async issue(_studentId: string, identity: NtagIdentity, operationId: string) {
        calls.issue += 1;
        seq += 1;
        const publicId = `P${String(seq).padStart(21, "0")}`;
        const card = {
          id: `card-${seq}`, publicId, medium: "nfc", status: "issued",
          nfc: { ...identity, state: "pending" as const, operationId, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), replacesCardId: null },
          cardToken: token(publicId), tokenAvailable: true,
        };
        cards.set(card.id, card);
        return card;
      },
      async replace(): Promise<never> { throw new Error("not used"); },
      async retry(): Promise<never> { throw new Error("not used"); },
      async confirm(card: EnrollmentCard, cardToken: string) {
        calls.confirm += 1;
        if (calls.failNextConfirm) {
          calls.failNextConfirm = false;
          throw Object.assign(new Error("Network request failed"), { code: "NETWORK_UNAVAILABLE", status: 0 });
        }
        assert.equal(cardToken, token(card.publicId), "la confirmation utilise le jeton relu sur la puce");
        const active = { ...card, status: "active", nfc: { ...card.nfc!, state: "encoded" as const } };
        cards.set(card.id, active);
        return active;
      },
    },
  };
}

/**
 * Utilisateur qui suit les consignes : à chaque demande de lecture qui attend, il retire la puce
 * puis la représente ; il ne la retire jamais autrement (elle reste contre le téléphone).
 */
function followPrompts(tag: FakeTag) {
  let running = true;
  let placed = false;
  const loop = (async () => {
    while (running) {
      const waiting = fake.state.request && !fake.state.request.tech;
      if (waiting && !placed) {
        placed = true; // la carte est posée quand Somafrik la demande
        fake.present(tag);
      } else if (waiting && fake.state.consumed) {
        fake.remove();
        fake.present(tag);
      }
      await sleep(5);
    }
  })();
  return async () => { running = false; await loop; };
}

/** Exécute une opération en garantissant l'arrêt de l'utilisateur simulé, même en cas d'échec. */
async function withUser<T>(tag: FakeTag, operation: () => Promise<T>): Promise<T> {
  const stop = followPrompts(tag);
  try {
    return await operation();
  } finally {
    await stop();
  }
}

function newFlow(hardware: ReturnType<typeof createNfcEncoderHardware>, api: ReturnType<typeof fakeApi>["api"], studentId = "stu") {
  let uuid = 0;
  return createIndividualNfcFlow({
    studentId, api, hardware,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    valid: () => true,
    phase: () => {},
  });
}

test.beforeEach(() => {
  Object.assign(fake.state, {
    registered: false, readerMode: false, registrations: 0, request: null, inField: null,
    consumed: false, externalDispatches: 0, writes: 0,
  });
});

test("RC-6B : pendant tout l'encodage, carte maintenue ou représentée, Android ne reprend jamais la puce", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  const card = await withUser(tag, async () => {
    const programmed = await newFlow(hardware, api).program();
    await sleep(1_300); // la carte reste posée après l'activation, panneau encore ouvert
    return programmed;
  });
  assert.equal(card.status, "active");
  assert.equal(calls.confirm, 1);
  assert.equal(fake.state.externalDispatches, 0, "com.android.apps.tag ouvert pendant l'encodage");
  assert.equal(fake.state.registrations, 1, "un seul Reader Mode pour toute la session d'encodage (vibrations répétées sinon)");
  assert.equal(fake.state.readerMode, true, "Reader Mode tenu tant que le panneau est ouvert");
  fake.remove();
  await hardware.end?.();
  assert.equal(fake.state.registered, false, "fermeture du panneau : Reader Mode rendu à Android");
});

test("RC-6C : trois cartes vierges encodées successivement, sans redémarrage ni bail périmé", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const tags = [blankTag("NTAG216"), blankTag("NTAG213"), blankTag("NTAG216")];
  for (const [index, tag] of tags.entries()) {
    const { api } = fakeApi();
    const card = await withUser(tag, () => newFlow(hardware, api, `stu-${index}`).program());
    fake.remove();
    assert.equal(card.status, "active", `carte ${index + 1}`);
    assert.equal(card.nfc?.uid, tag.id);
    assert.equal(card.nfc?.tagType, index === 1 ? "NTAG213" : "NTAG216");
  }
  assert.equal(fake.state.writes, 3);
  assert.equal(fake.state.externalDispatches, 0);
  // Exclusion mutuelle : aucune lecture concurrente pendant qu'un encodeur détient le bail.
  const reader = createNativeNfcSession();
  await reader.start();
  await reader.close();
  await hardware.end?.();
  assert.equal(fake.state.registered, false);
});

test("RC-6D : écriture réussie puis confirmation interrompue → reprise par relecture, sans réécriture", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  const flow = newFlow(hardware, api);
  calls.failNextConfirm = true;
  await assert.rejects(withUser(tag, () => flow.program()), { code: "NETWORK_UNAVAILABLE" });
  fake.remove();
  assert.equal(fake.state.writes, 1);
  assert.equal(calls.issue, 1);
  assert.equal(flow.hasUncertainReservation(), true);
  const card = await withUser(tag, () => flow.resume());
  assert.equal(card.status, "active");
  assert.equal(fake.state.writes, 1, "la reprise relit la puce, elle ne la réécrit jamais");
  assert.equal(calls.issue, 1, "aucune seconde réservation automatique");
  assert.equal(fake.state.externalDispatches, 0);
  fake.remove();
  await hardware.end?.();
});

test("RC-6A : cartes vierges NTAG213/216 reconnues ; non formatée, lecture seule et étrangère refusées sans réservation", { timeout: 25_000 }, async () => {
  const cases: { name: string; tag: FakeTag; code?: string }[] = [
    { name: "NTAG213 vierge", tag: blankTag("NTAG213") },
    { name: "NTAG216 enregistrement NDEF vide d'usine", tag: blankTag("NTAG216", { records: [{ tnf: 0, type: [], payload: [] }] }) },
    { name: "non formatée NDEF", tag: blankTag("NTAG216", { techs: ["NfcA", "MifareUltralight", "NdefFormatable"] }), code: "NFC_NDEF" },
    { name: "lecture seule", tag: blankTag("NTAG216", { writable: false }), code: "NFC_FOREIGN" },
    { name: "contenu étranger", tag: blankTag("NTAG216", { records: [{ tnf: 1, type: [0x54], payload: [2, 0x65, 0x6e, 0x68, 0x69] }] }), code: "NFC_FOREIGN" },
    { name: "autre puce (MIFARE)", tag: blankTag("NTAG216", { version: [0, 4, 3, 1, 1, 0, 0x0b, 3] }), code: "NFC_FOREIGN" },
  ];
  const hardware = createNfcEncoderHardware();
  for (const { name, tag, code } of cases) {
    const { api, calls } = fakeApi();
    const outcome = await withUser(tag, () => newFlow(hardware, api, name).program()).then((card) => card, (error) => error);
    fake.remove();
    if (code) {
      assert.equal(outcome?.code, code, name);
      assert.equal(calls.issue, 0, `${name} : aucune réservation créée`);
      assert.equal(tag.records === null || tag.records.length <= 1, true);
    } else {
      assert.equal(outcome?.status, "active", `${name} : ${outcome?.code ?? ""}`);
    }
  }
  assert.equal(fake.state.externalDispatches, 0);
  await hardware.end?.();
});
