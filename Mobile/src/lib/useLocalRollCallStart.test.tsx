// PRES-LOCAL-NAV-01 — démarrage de l'appel local depuis l'écran Présences : vrais effets React
// (react-dom sur un hôte minimal), liste serveur simulée, rôles Directeur / Secrétaire / Enseignant.
// Aucun appareil, aucun réseau.
//   npx --yes tsx --test Mobile/src/lib/useLocalRollCallStart.test.tsx
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { ROLL_CALL_PERMISSION, rollCallActor } from "./studentCardRollCallRoles";
import { resolveRollCallLauncher } from "./rollCallLauncher";
import { resetRollCallClassListsForTests, type DirectRollCallTarget } from "./rollCallDirectStart";
import { useLocalRollCallStart, type LocalRollCallStartArgs } from "./useLocalRollCallStart";
import type { RollCallClassOption } from "../services/rollCallOfflineApi";

class HTMLIFrameElement {}
const g = globalThis as Record<string, unknown>;
g.window = { event: undefined, HTMLIFrameElement, document: { activeElement: null } };
g.IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require("react-dom/client") as {
  createRoot: (container: Element) => { render: (node: React.ReactNode) => void; unmount: () => void };
};

function hostContainer() {
  const node: Record<string, unknown> = {
    nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [], textContent: "", addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
  };
  node.ownerDocument = { addEventListener() {}, removeEventListener() {}, defaultView: null, documentElement: node };
  return node as unknown as Element;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const CLASS_A = "3f2b8c1e-7d4a-4b9e-9c1a-2e5f6a7b8c9d";
const CLASS_B = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const option = (classId: string, className: string): RollCallClassOption => ({ classId, classCode: null, className, enrolled: 30 });
const WRITE = ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"];
const SETTINGS = { studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: true, studentCardAttendanceEnabled: true, studentCardOfflineRollCallEnabled: true };
const ROLES: Array<[string, string[], string[]]> = [
  ["Directeur", ["SCHOOL_ADMIN"], [ROLL_CALL_PERMISSION]],
  ["Secrétaire", ["SECRETARY"], [ROLL_CALL_PERMISSION, ...WRITE]],
  ["Enseignant", ["TEACHER"], [ROLL_CALL_PERMISSION, ...WRITE]],
];

type Props = Omit<LocalRollCallStartArgs, "onOpenPicker" | "onOpenTarget">;

/** Écran minimal : même câblage que TeacherAttendanceScreen (sélecteur ou cible directe). */
function mount(initial: Props) {
  const events: Array<{ kind: "picker" } | { kind: "target"; target: DirectRollCallTarget }> = [];
  let start: () => void = () => undefined;
  function Harness(props: Props) {
    start = useLocalRollCallStart({
      ...props,
      onOpenPicker: () => events.push({ kind: "picker" }),
      onOpenTarget: (target) => events.push({ kind: "target", target }),
    });
    return null;
  }
  const root = createRoot(hostContainer());
  act(() => root.render(<Harness {...initial} />));
  return {
    events,
    press: async () => {
      await act(async () => {
        start();
        await new Promise((resolve) => setImmediate(resolve));
      });
    },
    pressSync: () => act(() => start()),
    rerender: (props: Props) => act(() => root.render(<Harness {...props} />)),
    flush: () => act(async () => { await new Promise((resolve) => setImmediate(resolve)); }),
    unmount: () => act(() => root.unmount()),
  };
}

test("Directeur, Secrétaire, Enseignant : classe ouverte autorisée → un appui ouvre l'appel, sans sélecteur", async () => {
  for (const [label, keys, permissions] of ROLES) {
    resetRollCallClassListsForTests();
    const session = { user: { roleKeys: keys, permissions }, permissions };
    const launcher = resolveRollCallLauncher({ session, actor: rollCallActor(session), settings: SETTINGS as never, platformOs: "android" });
    assert.equal(launcher.canStartRollCall, true, `${label} : bouton visible`);
    let fetches = 0;
    const screen = mount({
      scopeKey: `env|school|${label}`,
      selectedClass: { classId: CLASS_A.toUpperCase(), className: "6e A" },
      fetchClasses: async () => { fetches += 1; return { classes: [option(CLASS_A, "6e A"), option(CLASS_B, "5e B")] }; },
    });
    await screen.press();
    assert.deepEqual(screen.events, [{ kind: "target", target: { classId: CLASS_A, className: "6e A" } }], label);
    assert.equal(fetches, 1, `${label} : une seule lecture de la liste`);
    screen.unmount();
  }
});

test("aucune classe ouverte → sélecteur immédiat, sans lecture réseau", async () => {
  let fetches = 0;
  const screen = mount({ scopeKey: "env|school|u", selectedClass: null, fetchClasses: async () => { fetches += 1; return { classes: [] }; } });
  await screen.press();
  assert.deepEqual(screen.events, [{ kind: "picker" }]);
  assert.equal(fetches, 0);
  screen.unmount();
});

test("classe non proposée / refus 403 / réseau sans copie → sélecteur (aucun contournement)", async () => {
  const cases: Array<[string, () => Promise<{ classes: RollCallClassOption[] }>]> = [
    ["classe absente de la liste", async () => ({ classes: [option(CLASS_B, "5e B")] })],
    ["droits retirés (403)", async () => { throw Object.assign(new Error("refus"), { status: 403 }); }],
    ["hors connexion sans copie", async () => { throw Object.assign(new Error("offline"), { status: 0 }); }],
  ];
  for (const [label, fetchClasses] of cases) {
    resetRollCallClassListsForTests();
    const screen = mount({ scopeKey: "env|school|u", selectedClass: { classId: CLASS_A, className: "6e A" }, fetchClasses });
    await screen.press();
    assert.deepEqual(screen.events, [{ kind: "picker" }], label);
    screen.unmount();
  }
});

test("double appui pendant la lecture → une seule ouverture (aucune seconde session)", async () => {
  resetRollCallClassListsForTests();
  const gate = deferred<{ classes: RollCallClassOption[] }>();
  let fetches = 0;
  const screen = mount({ scopeKey: "env|school|u", selectedClass: { classId: CLASS_A, className: "6e A" }, fetchClasses: () => { fetches += 1; return gate.promise; } });
  screen.pressSync();
  screen.pressSync();
  screen.pressSync();
  gate.resolve({ classes: [option(CLASS_A, "6e A")] });
  await screen.flush();
  assert.equal(fetches, 1);
  assert.equal(screen.events.length, 1);
  // Après la fin du démarrage, un nouvel appui reste possible (même classe → même brouillon).
  await screen.press();
  assert.equal(screen.events.length, 2);
  assert.deepEqual(screen.events.map((e) => e.kind === "target" && e.target.classId), [CLASS_A, CLASS_A]);
  screen.unmount();
});

test("classe ou compte changés pendant la lecture, ou écran fermé → rien n'est ouvert", async () => {
  const variants: Array<[string, (screen: ReturnType<typeof mount>, base: Props) => void]> = [
    ["changement de classe", (screen, base) => screen.rerender({ ...base, selectedClass: { classId: CLASS_B, className: "5e B" } })],
    ["changement de compte", (screen, base) => screen.rerender({ ...base, scopeKey: "env|school|autre" })],
    ["retour à la liste des classes", (screen, base) => screen.rerender({ ...base, selectedClass: null })],
    ["écran démonté", (screen) => screen.unmount()],
  ];
  for (const [label, change] of variants) {
    resetRollCallClassListsForTests();
    const gate = deferred<{ classes: RollCallClassOption[] }>();
    const base: Props = { scopeKey: "env|school|u", selectedClass: { classId: CLASS_A, className: "6e A" }, fetchClasses: () => gate.promise };
    const screen = mount(base);
    screen.pressSync();
    change(screen, base);
    gate.resolve({ classes: [option(CLASS_A, "6e A"), option(CLASS_B, "5e B")] });
    await screen.flush();
    assert.deepEqual(screen.events, [], label);
    if (label !== "écran démonté") screen.unmount();
  }
});

test("hors connexion avec copie récente du même compte → appel direct", async () => {
  resetRollCallClassListsForTests();
  let online = true;
  const fetchClasses = async () => {
    if (!online) throw Object.assign(new Error("offline"), { status: 0 });
    return { classes: [option(CLASS_A, "6e A")] };
  };
  const screen = mount({ scopeKey: "env|school|u", selectedClass: { classId: CLASS_A, className: "6e A" }, fetchClasses });
  await screen.press();
  online = false;
  await screen.press();
  assert.deepEqual(screen.events.map((e) => e.kind), ["target", "target"]);
  screen.unmount();
  // Autre compte, même appareil, hors connexion : la copie n'est pas partagée.
  const other = mount({ scopeKey: "env|school|autre", selectedClass: { classId: CLASS_A, className: "6e A" }, fetchClasses });
  await other.press();
  assert.deepEqual(other.events, [{ kind: "picker" }]);
  other.unmount();
});
