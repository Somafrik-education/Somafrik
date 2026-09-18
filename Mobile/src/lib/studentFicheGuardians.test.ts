import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyGuardiansLoad,
  guardiansCardSubtitle,
} from "./studentFicheGuardians";

test("PARITY-014 : 200 + liste vide → empty / Aucun responsable lié", () => {
  const state = classifyGuardiansLoad({ loading: false, error: null, items: [] });
  assert.equal(state, "empty");
  assert.equal(guardiansCardSubtitle(state, 0), "Aucun responsable lié");
});

test("PARITY-014 : 200 + responsables → success, jamais empty", () => {
  const state = classifyGuardiansLoad({ loading: false, error: null, items: [{ id: "r1" }] });
  assert.equal(state, "success");
  assert.equal(guardiansCardSubtitle(state, 1), "1 responsable(s)");
});

test("PARITY-014 : 403/500 ne deviennent pas « aucun responsable »", () => {
  const forbidden = classifyGuardiansLoad({
    loading: false,
    error: Object.assign(new Error("Accès refusé"), { status: 403 }),
    items: [],
  });
  const server = classifyGuardiansLoad({
    loading: false,
    error: Object.assign(new Error("Erreur serveur"), { status: 500 }),
    items: [],
  });
  assert.equal(forbidden, "error");
  assert.equal(server, "error");
  assert.equal(guardiansCardSubtitle(forbidden, 0), "Indisponible");
  assert.notEqual(guardiansCardSubtitle(forbidden, 0), "Aucun responsable lié");
});

test("PARITY-014 : offline → état offline + Indisponible", () => {
  const state = classifyGuardiansLoad({
    loading: false,
    error: Object.assign(new Error("Réseau indisponible"), { status: 0 }),
    items: [],
  });
  assert.equal(state, "offline");
  assert.equal(guardiansCardSubtitle(state, 0), "Indisponible");
});
