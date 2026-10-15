/**
 * NFC-RECETTE-05 — rendu réel de StudentCardNfcScannerModal (react-test-renderer).
 * Seuls le pont natif, l'API HTTP et les primitives React Native sont simulés.
 * RC-1 : un re-rendu du parent pendant « Identification en cours… » ne doit ni
 * bloquer `busy` ni perdre le résultat. RC-2 : l'attente NFC expire et libère
 * réellement la session matérielle.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { createElement, type ReactNode } from "react";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const appStateListeners = new Set<(state: string) => void>();
const host = (name: string) => ({ children, ...props }: { children?: ReactNode }) => createElement(name, props, children);
const reactNativeStub = {
  ActivityIndicator: host("ActivityIndicator"),
  ScrollView: host("ScrollView"),
  Text: host("Text"),
  TouchableOpacity: host("TouchableOpacity"),
  View: host("View"),
  Modal: ({ visible, children }: { visible: boolean; children?: ReactNode }) => (visible ? createElement("Modal", null, children) : null),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    addEventListener(_type: string, listener: (state: string) => void) {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
};

type ScanCall = { kind: "resolve" | "record" | "finance"; token: string; gate: Deferred<unknown>; idempotencyKey?: string };
const apiCalls: ScanCall[] = [];
function apiCall(kind: ScanCall["kind"], token: string, idempotencyKey?: string) {
  const gate = deferred<unknown>();
  apiCalls.push({ kind, token, gate, idempotencyKey });
  return gate.promise;
}
const scanApiStub = {
  resolveStudentCard: (token: string) => apiCall("resolve", token),
  recordStudentCardAttendance: (token: string, _attendance: unknown, options: { idempotencyKey: string }) =>
    apiCall("record", token, options.idempotencyKey),
  readStudentCardFinance: (token: string) => apiCall("finance", token),
};

const moduleApi = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = moduleApi._load;
moduleApi._load = function load(request: string, ...rest: unknown[]) {
  if (request === "react-native") return reactNativeStub;
  if (request === "@expo/vector-icons") return { Ionicons: () => null };
  if (request.endsWith("/studentCardNfcNative")) {
    return { createReactNativeNfcAdapter: () => { throw new Error("native adapter must not be used in tests"); } };
  }
  if (request.endsWith("/studentCardScanApi")) return scanApiStub;
  return originalLoad.call(this, request, ...rest);
};

// tsx compile le JSX Expo en runtime classique : React doit être visible globalement.
// eslint-disable-next-line @typescript-eslint/no-require-imports
(globalThis as { React?: unknown }).React = require("react");
type TestNode = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type TestRendererInstance = {
  root: { findAll(predicate: (node: TestNode) => boolean): TestNode[] };
  update(element: ReactNode): void;
  unmount(): void;
};
type TestRendererModule = {
  create(element: ReactNode): TestRendererInstance;
  act(callback: () => void | Promise<void>): Promise<void> & void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ScannerModal = require("./StudentCardNfcScannerModal").default as (props: Record<string, unknown>) => ReactNode;
const { act } = TestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN_A = `${"A".repeat(22)}.${"a".repeat(43)}`;
const TOKEN_B = `${"B".repeat(22)}.${"b".repeat(43)}`;
function ndefTag(token: string) {
  const text = `somafrik:card:${token}`;
  return {
    id: "04112233445566",
    ndefMessage: [{ type: "T", payload: [2, 0x65, 0x6e, ...Array.from(text, (char) => char.charCodeAt(0))] }],
  };
}

function fakeHardware() {
  let discovery: Deferred<void> | null = null;
  let tag: unknown = null;
  const counts = { requestTag: 0, cancel: 0 };
  return {
    counts,
    get waiting() { return discovery !== null; },
    hardware: {
      async start() {},
      async isSupported() { return true; },
      async isEnabled() { return true; },
      requestTag() {
        counts.requestTag += 1;
        discovery = deferred<void>();
        return discovery.promise;
      },
      async getTag() { return tag; },
      async cancel() {
        counts.cancel += 1;
        const pending = discovery;
        discovery = null;
        pending?.reject(Object.assign(new Error("cancelled"), { code: "NFC_SESSION_CANCELLED" }));
      },
    },
    present(next: unknown) {
      assert.ok(discovery, "aucune session NFC n'écoute");
      tag = next;
      const pending = discovery;
      discovery = null;
      pending.resolve();
    },
  };
}

const CLASS = { classId: "class-1", classCode: "CL-1", className: "6e A" };
function resolved(token: string) {
  const suffix = token === TOKEN_A ? "A" : "B";
  return {
    card: { id: `card-${suffix}`, publicId: `pub-${suffix}`, medium: "nfc", status: "active" },
    student: { id: `stu-${suffix}`, studentCode: `CODE-${suffix}`, firstName: "Élève", lastName: suffix },
    class: { id: CLASS.classId, classCode: CLASS.classCode, className: CLASS.className },
  };
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await flush();
  }
  assert.fail(`condition jamais atteinte : ${label}`);
}

function mount(overrides: Record<string, unknown> = {}) {
  const device = fakeHardware();
  const recorded: unknown[] = [];
  let closes = 0;
  const base: Record<string, unknown> = {
    visible: true,
    selectedClass: CLASS,
    resourceScopeKey: "scope-1",
    schoolCode: "CD-TEST-01",
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-15",
    financeEnabled: false,
    isOffline: () => false,
    hardware: device.hardware,
    qrFallbackEnabled: false,
    ...overrides,
  };
  // Le parent réel passe des callbacks inline : une nouvelle identité à chaque rendu.
  const props = () => ({
    ...base,
    onClose: () => { closes += 1; },
    onFallbackQr: () => {},
    onAttendanceRecorded: (view: unknown) => { recorded.push(view); },
  });
  let renderer!: TestRendererInstance;
  act(() => { renderer = TestRenderer.create(createElement(ScannerModal, props())); });
  const byTestId = (id: string) => renderer.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
  const textOf = (node: TestNode): string =>
    node.children.map((child) => (typeof child === "string" ? child : textOf(child as TestNode))).join("");
  return {
    device,
    recorded,
    get closes() { return closes; },
    rerender(next: Record<string, unknown> = {}) {
      Object.assign(base, next);
      act(() => { renderer.update(createElement(ScannerModal, props())); });
    },
    status: () => textOf(byTestId("student-card-nfc-status")[0]),
    error: () => (byTestId("student-card-nfc-error")[0] ? textOf(byTestId("student-card-nfc-error")[0]) : ""),
    result: () => (byTestId("student-card-nfc-result")[0] ? textOf(byTestId("student-card-nfc-result")[0]) : ""),
    retry: () => byTestId("student-card-nfc-retry")[0],
    press(id: string) {
      const target = byTestId(id)[0];
      act(() => { (target.props.onPress as () => void)(); });
    },
    unmount() { act(() => renderer.unmount()); },
  };
}

function pending(kind: ScanCall["kind"]) {
  return apiCalls.filter((call) => call.kind === kind);
}

test.beforeEach(() => { apiCalls.length = 0; });

test("RC-1 : un re-rendu du parent pendant l'identification ne bloque pas « Identification en cours… »", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution envoyée");
  assert.match(view.status(), /Identification en cours/);

  view.rerender(); // ex. rechargement du contexte AdminData : nouveaux callbacks inline

  await act(async () => { pending("resolve")[0].gate.resolve(resolved(TOKEN_A)); });
  await waitUntil(() => pending("record").length === 1, "pointage envoyé");
  await act(async () => { pending("record")[0].gate.resolve(resolved(TOKEN_A)); });
  await flush();

  assert.doesNotMatch(view.status(), /Identification en cours/);
  assert.match(view.result(), /CODE-A/);
  assert.equal(view.recorded.length, 1);
  assert.equal(view.retry().props.disabled, false);
  view.unmount();
});

test("RC-1 : un re-rendu pendant l'attente de la carte ne perd pas la lecture", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  view.rerender();
  await flush();
  assert.equal(view.device.waiting, true, "la session d'origine écoute toujours");
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution envoyée");
  await act(async () => { pending("resolve")[0].gate.resolve(resolved(TOKEN_A)); });
  await waitUntil(() => pending("record").length === 1, "pointage envoyé");
  await act(async () => { pending("record")[0].gate.resolve(resolved(TOKEN_A)); });
  await flush();
  assert.equal(view.recorded.length, 1);
  view.unmount();
});

test("fermeture pendant l'identification : annulation, aucun pointage, aucun résultat périmé", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution envoyée");
  view.press("student-card-nfc-close");
  assert.equal(view.closes, 1);
  view.rerender({ visible: false });
  await act(async () => { pending("resolve")[0].gate.resolve(resolved(TOKEN_A)); });
  await flush();
  assert.equal(pending("record").length, 0, "aucun pointage après fermeture");
  assert.equal(view.recorded.length, 0);

  view.rerender({ visible: true });
  await waitUntil(() => view.device.waiting, "nouvelle session après réouverture");
  assert.doesNotMatch(view.status(), /Identification en cours/);
  assert.equal(view.result(), "");
  view.unmount();
});

test("fermeture puis réouverture pendant l'identification : le nouveau lecteur écoute immédiatement", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution envoyée");
  view.press("student-card-nfc-close");
  view.rerender({ visible: false });
  view.rerender({ visible: true });
  await waitUntil(() => view.device.waiting, "nouvelle session malgré la requête périmée");
  await act(async () => { pending("resolve")[0].gate.resolve(resolved(TOKEN_A)); });
  await flush();
  assert.equal(pending("record").length, 0, "la lecture périmée ne pointe pas");
  assert.equal(view.device.waiting, true, "la requête périmée ne ferme pas le nouveau lecteur");
  await act(async () => { view.device.present(ndefTag(TOKEN_B)); });
  await waitUntil(() => pending("resolve").some((call) => call.token === TOKEN_B), "nouvelle carte résolue");
  view.unmount();
});

test("changement de classe pendant l'identification : résultat ignoré et lecteur fermé", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution envoyée");
  view.rerender({ selectedClass: { classId: "class-2", classCode: "CL-2" } });
  assert.equal(view.closes, 1, "le changement de périmètre ferme le lecteur");
  await act(async () => { pending("resolve")[0].gate.resolve(resolved(TOKEN_A)); });
  await flush();
  assert.equal(pending("record").length, 0);
  assert.equal(view.recorded.length, 0);
  assert.doesNotMatch(view.status(), /Identification en cours/);
  view.unmount();
});

test("RC-2 : l'attente NFC expire, annule la session matérielle et autorise Réessayer", async () => {
  const view = mount({ nfcTimeoutMs: 40 });
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  const cancelsBefore = view.device.counts.cancel;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
  await flush();
  assert.equal(view.device.waiting, false, "la découverte Android doit être annulée");
  assert.ok(view.device.counts.cancel > cancelsBefore, "cancelTechnologyRequest appelé");
  assert.match(view.error(), /Aucune carte détectée/);
  assert.equal(view.retry().props.disabled, false);

  view.press("student-card-nfc-retry");
  await waitUntil(() => view.device.waiting, "nouvelle session après Réessayer");
  assert.equal(view.device.counts.requestTag, 2);
  await act(async () => { view.device.present(ndefTag(TOKEN_A)); });
  await waitUntil(() => pending("resolve").length === 1, "résolution après réessai");
  view.unmount();
});

test("lectures successives : un seul pointage par lecture, clés d'idempotence distinctes", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  for (const token of [TOKEN_A, TOKEN_B]) {
    await act(async () => { view.device.present(ndefTag(token)); });
    await waitUntil(() => pending("resolve").some((call) => call.token === token), "résolution envoyée");
    view.press("student-card-nfc-retry"); // désactivé pendant l'identification : sans effet
    view.rerender();
    await act(async () => { pending("resolve").find((call) => call.token === token)!.gate.resolve(resolved(token)); });
    await waitUntil(() => pending("record").some((call) => call.token === token), "pointage envoyé");
    await act(async () => { pending("record").find((call) => call.token === token)!.gate.resolve(resolved(token)); });
    await flush();
    assert.equal(view.retry().props.disabled, false);
    view.press("student-card-nfc-retry");
    await waitUntil(() => view.device.waiting, "lecteur réarmé");
  }
  assert.equal(pending("record").length, 2);
  assert.equal(view.recorded.length, 2);
  const keys = pending("record").map((call) => call.idempotencyKey);
  assert.equal(new Set(keys).size, 2);
  assert.equal(view.device.counts.requestTag, 3);
  view.unmount();
});

test("passage en arrière-plan : session NFC annulée, Réessayer disponible au retour", async () => {
  const view = mount();
  await waitUntil(() => view.device.waiting, "session NFC ouverte");
  act(() => { for (const listener of appStateListeners) listener("background"); });
  await flush();
  assert.equal(view.device.waiting, false);
  act(() => { for (const listener of appStateListeners) listener("active"); });
  await flush();
  assert.equal(view.retry().props.disabled, false);
  view.press("student-card-nfc-retry");
  await waitUntil(() => view.device.waiting, "session rouverte");
  view.unmount();
});
