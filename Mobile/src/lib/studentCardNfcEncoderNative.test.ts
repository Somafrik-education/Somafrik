/**
 * NFC-RECETTE-06 / RC-6 et CARTE-NFC-ONE-TAP-01 — encodage NFC de bout en bout côté Mobile.
 * Vraie couche JS react-native-nfc-manager 4.0.0-beta.10, vrai adaptateur d'encodage, vrai
 * gestionnaire de session partagé et vrais flux individuel / par lot ; seul le module natif est
 * simulé, d'après NfcManager.java, NdefHandler.java, NfcTechIoRouter.java et TagTechnologyRequest.java :
 * - Reader Mode piloté par register/unregisterTagEvent ; une puce encore dans le champ quand il est
 *   coupé est redistribuée par Android à com.android.apps.tag ;
 * - une puce présente n'est découverte qu'une fois (onTagDiscovered) tant qu'elle n'est pas retirée ;
 * - `this.tag` garde la dernière puce découverte : connect(techs) / close() changent de technologie
 *   sur cette même puce sans nouvelle découverte (échec si elle a quitté le champ) ;
 * - getNdefMessage / getTag renvoient le message NDEF mis en cache à la découverte (buildNdefJSON) ;
 * - transceive NfcA : GET_VERSION et READ (30h) sur une vraie mémoire NTAG213/216 (pages, CC, TLV).
 */
import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";

type Callback = (error: unknown, result?: unknown) => void;
type NdefRecordLike = { tnf: number; type: number[]; payload: number[]; id?: number[] };
type Model = "NTAG213" | "NTAG216";
type FakeTag = {
  id: string;
  model: Model;
  techs: string[];
  version: number[];
  memory: number[]; // pages de 4 octets, page 3 = CC, zone de données à partir de la page 4
  writable: boolean;
  maxSize: number;
};

const nodeRequire = createRequire(import.meta.url);
const ndefLib = nodeRequire("react-native-nfc-manager/dist/ndef-lib");
const PAGES: Record<Model, number> = { NTAG213: 45, NTAG216: 231 };
const DATA_BYTES: Record<Model, number> = { NTAG213: 144, NTAG216: 872 };

/** Enregistrement NDEF court (SR) unique, octets bruts tels qu'écrits sur la puce. */
function encodeRecord(record: NdefRecordLike): number[] {
  return [0xd0 | record.tnf, record.type.length, record.payload.length, ...record.type, ...record.payload];
}
/** Message NDEF → mémoire : TLV 03h + terminateur FEh à partir de la page 4. */
function writeMessage(tag: FakeTag, message: number[]) {
  const tlv = message.length < 0xff ? [0x03, message.length] : [0x03, 0xff, message.length >> 8, message.length & 0xff];
  const area = [...tlv, ...message, 0xfe];
  if (area.length > DATA_BYTES[tag.model]) throw new Error("capacity");
  area.forEach((byte, i) => { tag.memory[16 + i] = byte; });
}
/** Ce qu'Android met en cache à la découverte (Ndef.getCachedNdefMessage), en octets comme Util.recordToJSON. */
function cachedRecords(tag: FakeTag): NdefRecordLike[] | null {
  if (!tag.techs.includes("Ndef")) return null;
  const area = tag.memory.slice(16);
  let at = 0;
  while (area[at] === 0x00) at += 1;
  if (area[at] !== 0x03) return null;
  const long = area[at + 1] === 0xff;
  const size = long ? (area[at + 2] << 8) | area[at + 3] : area[at + 1];
  if (size === 0) return null;
  const start = at + (long ? 4 : 2);
  const asBytes = (value: unknown) => typeof value === "string" ? Array.from(value, (c) => c.charCodeAt(0)) : Array.from(value as ArrayLike<number>);
  return ndefLib.decodeMessage(area.slice(start, start + size)).map((r: { tnf: number; type: unknown; payload: unknown }) => ({
    tnf: r.tnf, type: asBytes(r.type), payload: asBytes(r.payload),
  }));
}

function createFakeNative() {
  // Le cache Android (extras du Tag) est figé au moment de la découverte.
  const snapshotAtDiscovery = new WeakMap<FakeTag, NdefRecordLike[] | null>();
  const state = {
    registered: false,
    readerMode: false,
    registrations: 0,
    request: null as null | { techs: string[]; callback: Callback | null; tech: string | null; tag: FakeTag | null; snapshot: NdefRecordLike[] | null },
    inField: null as FakeTag | null,
    lastTag: null as FakeTag | null, // NfcManager.this.tag
    consumed: false, // la puce présente a déjà été découverte en Reader Mode (pas de nouvelle découverte sans la retirer)
    discoveries: 0,
    externalDispatches: 0,
    writes: 0,
    connects: [] as string[],
    readsAfterWrite: 0,
    wrote: false,
    onWrite: null as null | ((tag: FakeTag) => void),
  };
  function connect(tag: FakeTag) {
    const request = state.request;
    if (!request || request.tech) return false;
    const tech = request.techs.find((candidate) => tag.techs.includes(candidate));
    if (!tech) return false;
    state.discoveries += 1;
    state.lastTag = tag;
    request.tech = tech;
    request.tag = tag;
    request.snapshot = snapshotAtDiscovery.get(tag) ?? null;
    state.consumed = true;
    request.callback?.(null, tech);
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
    if (!request?.tech || !request.tag) throw new Error("no tech request available");
    if (request.tech !== tech) throw new Error(`${tech} unavailable on ${request.tech}`);
    if (state.inField !== request.tag) throw new Error("android.nfc.TagLostException: Tag was lost.");
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
      state.request = { techs, callback: cb, tech: null, tag: null, snapshot: null };
      if (state.inField && state.readerMode && !state.consumed) connect(state.inField);
    },
    cancelTechnologyRequest(cb: Callback) {
      const request = state.request;
      state.request = null;
      if (request && !request.tech) request.callback?.("cancelled");
      cb(null);
    },
    /** NfcManager.connect : nouvelle TagTechnologyRequest sur this.tag, sans découverte. */
    connect(techs: string[], cb: Callback) {
      if (state.request) return cb("You can only issue one request at a time");
      const tag = state.lastTag;
      if (!tag) return cb("no reference available");
      const tech = techs.find((candidate) => tag.techs.includes(candidate));
      // TagTechnologyRequest.connect avale l'exception (puce retirée) et renvoie false.
      if (!tech || state.inField !== tag) return cb("unsupported tag api");
      state.connects.push(tech);
      state.request = { techs, callback: null, tech, tag, snapshot: snapshotAtDiscovery.get(tag) ?? null };
      cb(null, null);
    },
    /** NfcManager.close : ferme la technologie courante (detachTechnologyRequest). */
    close(cb: Callback) {
      if (!state.request) return cb("no tech request available");
      state.request = null;
      cb(null, null);
    },
    getTag(cb: Callback) {
      const request = state.request;
      if (!request?.tech || !request.tag) return cb("no tech request available");
      cb(null, { id: request.tag.id, techTypes: request.tag.techs.map((t) => `android.nfc.tech.${t}`) });
    },
    transceive(bytes: number[], cb: Callback) {
      try {
        const request = connected("NfcA");
        const tag = request.tag!;
        if (bytes.length === 1 && bytes[0] === 0x60) return cb(null, tag.version);
        if (bytes.length === 2 && bytes[0] === 0x30) {
          if (state.wrote) state.readsAfterWrite += 1;
          const total = tag.memory.length;
          return cb(null, Array.from({ length: 16 }, (_, i) => tag.memory[(bytes[1] * 4 + i) % total]));
        }
        cb("unsupported command");
      } catch (error) { cb(String(error)); }
    },
    getNdefMessage(cb: Callback) {
      try {
        const request = connected("Ndef");
        cb(null, { id: request.tag!.id, ndefMessage: request.snapshot });
      } catch (error) { cb(String(error)); }
    },
    queryNdefStatus(cb: Callback) {
      try {
        const request = connected("Ndef");
        cb(null, { isWritable: request.tag!.writable, maxSize: request.tag!.maxSize, canMakeReadOnly: true });
      } catch (error) { cb(String(error)); }
    },
    writeNdefMessage(bytes: number[], _options: unknown, cb: Callback) {
      try {
        const request = connected("Ndef");
        if (!request.tag!.writable) return cb("read only");
        writeMessage(request.tag!, bytes);
        state.writes += 1;
        state.wrote = true;
        state.onWrite?.(request.tag!);
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
    present(tag: FakeTag) { state.inField = tag; state.consumed = false; snapshotAtDiscovery.set(tag, cachedRecords(tag)); discover(); },
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
const { createNfcBatch } = require("./studentCardNfcBatch") as typeof import("./studentCardNfcBatch");
const { createNativeNfcSession } = require("./nfcSessionNative") as typeof import("./nfcSessionNative");
/* eslint-enable @typescript-eslint/no-require-imports */
type EnrollmentCard = import("./studentCardNfcEncoding").EnrollmentCard;
type NtagIdentity = import("./studentCardNfcEncoding").NtagIdentity;

const NTAG213 = [0, 4, 4, 2, 1, 0, 0x0f, 3];
const NTAG216 = [0, 4, 4, 2, 1, 0, 0x13, 3];
let uidCounter = 0x10;
function blankTag(model: Model = "NTAG216", overrides: Partial<FakeTag> & { records?: NdefRecordLike[] | null } = {}): FakeTag {
  uidCounter += 1;
  const { records = null, ...rest } = overrides;
  const tag: FakeTag = {
    id: `04AABBCCDD${uidCounter.toString(16).toUpperCase().padStart(2, "0")}${uidCounter % 10}0`.slice(0, 14),
    model,
    techs: ["NfcA", "MifareUltralight", "Ndef"],
    version: model === "NTAG213" ? NTAG213 : NTAG216,
    memory: Array.from({ length: PAGES[model] * 4 }, () => 0),
    writable: true,
    maxSize: model === "NTAG213" ? 137 : 868,
    ...rest,
  };
  if (tag.techs.includes("Ndef")) {
    tag.memory.splice(12, 4, 0xe1, 0x10, DATA_BYTES[model] / 8, tag.writable ? 0x00 : 0x0f);
    writeMessage(tag, records ? records.flatMap(encodeRecord) : []); // vierge : TLV 03 00 FE (« Tag vide »)
  }
  return tag;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeApi() {
  let seq = 0;
  const cards = new Map<string, EnrollmentCard & { cardToken?: string; studentId?: string }>();
  const calls = { issue: 0, confirm: 0, failNextConfirm: false, failNextIssue: null as null | string, onIssue: null as null | (() => Promise<void> | void) };
  const token = (publicId: string) => `${publicId}.${"s".repeat(43)}`;
  return {
    calls,
    cards,
    api: {
      async list(studentId: string) {
        return { cards: [...cards.values()].filter((c) => c.studentId === studentId).map(({ cardToken: _t, studentId: _s, ...card }) => card), nfcEnabled: true };
      },
      async issue(studentId: string, identity: NtagIdentity, operationId: string) {
        calls.issue += 1;
        if (calls.failNextIssue) {
          const code = calls.failNextIssue;
          calls.failNextIssue = null;
          throw Object.assign(new Error(code), { code });
        }
        await calls.onIssue?.();
        seq += 1;
        const publicId = `P${String(seq).padStart(21, "0")}`;
        const card = {
          id: `card-${seq}`, publicId, medium: "nfc", status: "issued",
          nfc: { ...identity, state: "pending" as const, operationId, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), replacesCardId: null },
          cardToken: token(publicId), tokenAvailable: true, studentId,
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
        cards.set(card.id, { ...active, studentId: cards.get(card.id)?.studentId });
        return active;
      },
    },
  };
}

/**
 * Utilisateur qui suit les consignes : il pose la carte quand Somafrik la demande et la maintient ;
 * il ne la retire puis ne la représente que si Somafrik attend une nouvelle découverte alors que la
 * carte a déjà été lue (chaque cas est compté comme une présentation supplémentaire).
 */
let presentations = 0;
function followPrompts(tag: FakeTag) {
  let running = true;
  let placed = false;
  const loop = (async () => {
    while (running) {
      const waiting = fake.state.request && !fake.state.request.tech;
      if (waiting && !placed) {
        placed = true;
        presentations += 1;
        fake.present(tag);
      } else if (waiting && fake.state.consumed) {
        fake.remove();
        presentations += 1;
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

function newFlow(hardware: ReturnType<typeof createNfcEncoderHardware>, api: ReturnType<typeof fakeApi>["api"], studentId = "stu", valid = () => true) {
  let uuid = 0;
  return createIndividualNfcFlow({
    studentId, api, hardware,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    valid,
    phase: () => {},
  });
}

test.beforeEach(() => {
  Object.assign(fake.state, {
    registered: false, readerMode: false, registrations: 0, request: null, inField: null, lastTag: null,
    consumed: false, discoveries: 0, externalDispatches: 0, writes: 0, connects: [], readsAfterWrite: 0, wrote: false, onWrite: null,
  });
  presentations = 0;
});

// ---------------------------------------------------------------- RC-6 (non-régression)

test("RC-6B : pendant tout l'encodage, carte maintenue, Android ne reprend jamais la puce (5 s après l'activation)", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  const card = await withUser(tag, async () => {
    const programmed = await newFlow(hardware, api).program();
    await sleep(5_000); // la carte reste posée après l'activation, panneau encore ouvert
    return programmed;
  });
  assert.equal(card.status, "active");
  assert.equal(calls.confirm, 1);
  assert.equal(fake.state.externalDispatches, 0, "com.android.apps.tag ouvert pendant l'encodage");
  assert.equal(fake.state.registrations, 1, "un seul Reader Mode pour toute la session d'encodage (vibrations répétées sinon)");
  assert.equal(fake.state.readerMode, true, "Reader Mode tenu tant que le panneau est ouvert");
  assert.equal(fake.state.request, null, "aucune technologie NFC retenue après l'activation");
  fake.remove();
  await hardware.end?.();
  assert.equal(fake.state.registered, false, "fermeture du panneau : Reader Mode rendu à Android");
});

test("RC-6C / ONE-TAP 3 : trois cartes successives, trois découvertes NFC au total, sans bail périmé", { timeout: 25_000 }, async () => {
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
  assert.equal(fake.state.discoveries, 3, "une seule découverte NFC par carte");
  assert.equal(presentations, 3, "une seule présentation par carte");
  assert.equal(fake.state.externalDispatches, 0);
  // Exclusion mutuelle : le bail est libre entre deux cartes et après la dernière.
  const reader = createNativeNfcSession();
  await reader.start();
  await reader.close();
  await hardware.end?.();
  assert.equal(fake.state.registered, false);
});

test("RC-6D / ONE-TAP 10 : écriture réussie puis confirmation interrompue → reprise par relecture, sans réécriture", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  const flow = newFlow(hardware, api);
  calls.failNextConfirm = true;
  await assert.rejects(withUser(tag, () => flow.program()), { code: "NETWORK_UNAVAILABLE" });
  fake.remove();
  assert.equal(fake.state.writes, 1);
  assert.equal(calls.issue, 1);
  assert.equal(presentations, 1);
  assert.equal(flow.hasUncertainReservation(), true);
  assert.equal(fake.state.request, null, "session NFC libérée après l'échec réseau");
  presentations = 0;
  const card = await withUser(tag, () => flow.resume());
  assert.equal(card.status, "active");
  assert.equal(presentations, 1, "la reprise relit la carte en une seule présentation");
  assert.equal(fake.state.writes, 1, "la reprise relit la puce, elle ne la réécrit jamais");
  assert.equal(calls.issue, 1, "aucune seconde réservation automatique");
  assert.equal(fake.state.externalDispatches, 0);
  fake.remove();
  await hardware.end?.();
});

test("RC-6A / ONE-TAP 11 : cartes vierges reconnues ; non formatée, lecture seule et étrangère refusées sans réservation", { timeout: 25_000 }, async () => {
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
    presentations = 0;
    const outcome = await withUser(tag, () => newFlow(hardware, api, name).program()).then((card) => card, (error) => error);
    fake.remove();
    assert.equal(presentations, 1, `${name} : une seule présentation`);
    if (code) {
      assert.equal(outcome?.code, code, name);
      assert.equal(calls.issue, 0, `${name} : aucune réservation créée`);
    } else {
      assert.equal(outcome?.status, "active", `${name} : ${outcome?.code ?? ""}`);
    }
  }
  assert.equal(fake.state.writes, 2);
  assert.equal(fake.state.externalDispatches, 0);
  await hardware.end?.();
});

// ---------------------------------------------------------------- CARTE-NFC-ONE-TAP-01

for (const model of ["NTAG213", "NTAG216"] as const) {
  test(`ONE-TAP ${model === "NTAG213" ? 1 : 2} : ${model} maintenue — une découverte, une écriture, une relecture physique, une confirmation`, { timeout: 25_000 }, async () => {
    const hardware = createNfcEncoderHardware();
    const { api, calls } = fakeApi();
    const tag = blankTag(model);
    const card = await withUser(tag, () => newFlow(hardware, api).program());
    assert.equal(card.status, "active");
    assert.equal(presentations, 1, "aucune demande de retrait puis de nouvelle présentation");
    assert.equal(fake.state.discoveries, 1, "une seule découverte NFC");
    assert.equal(fake.state.writes, 1);
    assert.equal(calls.issue, 1);
    assert.equal(calls.confirm, 1);
    assert.ok(fake.state.readsAfterWrite >= 2, "la relecture lit réellement la mémoire de la puce (READ NfcA) après l'écriture");
    assert.ok(fake.state.connects.includes("Ndef") && fake.state.connects.includes("NfcA"), "changements NfcA → Ndef → NfcA sur la même puce");
    assert.equal(cachedRecords(tag)?.length, 1, "la puce contient bien le message écrit");
    assert.equal(fake.state.request, null);
    fake.remove();
    await hardware.end?.();
  });
}

test("ONE-TAP 5 : carte retirée après la réservation, avant l'écriture → arrêt sûr, aucune écriture, reprise sans réécriture automatique", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG213");
  calls.onIssue = () => fake.remove();
  const flow = newFlow(hardware, api);
  await assert.rejects(withUser(tag, () => flow.program()), { code: "NFC_TAG_LOST" });
  assert.equal(fake.state.writes, 0);
  assert.equal(calls.issue, 1);
  assert.equal(calls.confirm, 0);
  assert.equal(fake.state.request, null, "session NFC libérée");
  calls.onIssue = null;
  // Reprise : la carte est relue ; elle est vide, donc aucune écriture sans confirmation explicite.
  await assert.rejects(withUser(tag, () => flow.resume()), { code: "NFC_REWRITE_REQUIRED" });
  assert.equal(fake.state.writes, 0);
  assert.equal(calls.issue, 1);
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 6 : carte retirée après l'écriture, avant la relecture → aucune confirmation ; reprise par relecture, une seule écriture", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  fake.state.onWrite = () => { fake.remove(); fake.state.onWrite = null; };
  const flow = newFlow(hardware, api);
  await assert.rejects(withUser(tag, () => flow.program()), { code: "NFC_TAG_LOST" });
  assert.equal(fake.state.writes, 1);
  assert.equal(calls.confirm, 0, "aucune confirmation sans relecture réelle");
  assert.equal(fake.state.request, null);
  presentations = 0;
  const card = await withUser(tag, () => flow.resume());
  assert.equal(card.status, "active");
  assert.equal(presentations, 1);
  assert.equal(fake.state.writes, 1, "jamais de seconde écriture automatique");
  assert.equal(calls.issue, 1);
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 7 : NDEF relu différent de l'écriture → NFC_READBACK, aucune confirmation", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  // Écriture partiellement corrompue sur la puce (dernier octet du jeton altéré).
  fake.state.onWrite = (t) => {
    const at = t.memory.indexOf(0xfe, 16) - 1;
    t.memory[at] ^= 0x01;
    fake.state.onWrite = null;
  };
  await assert.rejects(withUser(tag, () => newFlow(hardware, api).program()), { code: "NFC_READBACK" });
  assert.equal(calls.confirm, 0);
  assert.equal(presentations, 1);
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 8a : réservation lente → la puce n'est pas retenue au-delà du délai ; reprise contrôlée par une nouvelle présentation", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware(undefined, { holdIdleMs: 200 });
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  let heldDuringNetwork: unknown = "not observed";
  calls.onIssue = async () => { await sleep(600); heldDuringNetwork = fake.state.request; };
  const card = await withUser(tag, () => newFlow(hardware, api).program());
  assert.equal(heldDuringNetwork, null, "aucune technologie NFC retenue pendant une requête réseau trop longue");
  assert.equal(card.status, "active");
  assert.equal(presentations, 2, "une nouvelle présentation est demandée après la libération");
  assert.equal(fake.state.writes, 1);
  assert.equal(calls.issue, 1);
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 8b : opération interrompue (droits perdus) pendant la réservation → aucune écriture, session libérée", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const tag = blankTag("NTAG216");
  let valid = true;
  calls.onIssue = () => { valid = false; };
  await assert.rejects(withUser(tag, () => newFlow(hardware, api, "stu", () => valid).program()), { code: "NFC_CANCELLED" });
  assert.equal(fake.state.writes, 0);
  assert.equal(fake.state.request, null);
  const reader = createNativeNfcSession();
  await reader.start(); // le lecteur de présence peut reprendre le bail
  await reader.close();
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 9 : échec de réservation serveur → aucune écriture, session libérée", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  calls.failNextIssue = "STUDENT_CARD_NFC_UID_EXISTS";
  await assert.rejects(withUser(blankTag("NTAG213"), () => newFlow(hardware, api).program()), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
  assert.equal(fake.state.writes, 0);
  assert.equal(fake.state.request, null);
  assert.equal(presentations, 1);
  fake.remove();
  await hardware.end?.();
});

test("ONE-TAP 13 : programmation par lot, trois élèves, cartes maintenues → trois découvertes, passage automatique", { timeout: 25_000 }, async () => {
  const hardware = createNfcEncoderHardware();
  const { api, calls } = fakeApi();
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const tags = [blankTag("NTAG213"), blankTag("NTAG216"), blankTag("NTAG213")];
  const batch = createNfcBatch({
    classId: "c0000000-0000-4000-8000-000000000000", classCode: "8D", api, hardware, valid: () => true,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
    async loadRoster() { return { classId: "c0000000-0000-4000-8000-000000000000", classCode: "8D", className: "8ème D", students: ids.map((id, i) => ({ id, name: `Élève ${i + 1}`, code: `E${i}` })) }; },
    changed() {},
  });
  // L'opérateur pose la carte de l'élève courant et la retire seulement quand l'élève est activé.
  let next = 0, done = calls.confirm;
  let running = true;
  const operator = (async () => {
    while (running) {
      const waiting = fake.state.request && !fake.state.request.tech;
      if (waiting && (!fake.state.inField || calls.confirm > done)) {
        done = calls.confirm;
        fake.remove();
        presentations += 1;
        fake.present(tags[next++]);
      } else if (waiting && fake.state.consumed) {
        fake.remove();
        presentations += 1;
        fake.present(tags[next - 1]);
      }
      await sleep(5);
    }
  })();
  try {
    await batch.prepare();
    batch.selectAll();
    await batch.start();
  } finally { running = false; await operator; }
  assert.deepEqual(batch.snapshot().counters, { total: 3, programmed: 3, remaining: 0, errors: 0, inProgress: 0 });
  assert.equal(fake.state.discoveries, 3);
  assert.equal(presentations, 3);
  assert.equal(fake.state.writes, 3);
  assert.equal(fake.state.externalDispatches, 0);
  fake.remove();
  await hardware.end?.();
});
