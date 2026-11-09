"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRouteRegistry } = require("./routeRegistry");
const { composeModules } = require("./composeModules");
const { MODULE_CATALOG } = require("./catalog");
const { loadBackendModules } = require("./loadModules");

function fakeApp() {
  const calls = [];
  const app = {};
  for (const verb of ["get", "post", "put", "patch", "delete", "all"]) {
    app[verb] = (routePath, ...handlers) => {
      calls.push({ verb, path: routePath, handlers });
      return app;
    };
  }
  app.calls = calls;
  return app;
}

function named(label) {
  const fn = function placeholder() {};
  Object.defineProperty(fn, "name", { value: label });
  return fn;
}

test("le catalogue de production accepte une application Express (fonction)", () => {
  const app = function application() {};
  for (const verb of ["get", "post", "put", "patch", "delete", "all"]) {
    app[verb] = () => app;
  }
  const report = loadBackendModules(app);
  assert.equal(report.routeCount, 0);
});

test("le catalogue de production reste inline, dans l'ordre prévu, sans route", () => {
  const app = fakeApp();
  const report = loadBackendModules(app);
  assert.deepEqual(
    report.order,
    ["finance", "students", "users", "attendance", "notes", "planning", "communications", "administration", "platform"],
  );
  assert.equal(report.routeCount, 0);
  assert.equal(app.calls.length, 0);
  assert.ok(MODULE_CATALOG.every((mod) => mod.status === "inline"));
});

test("un module extrait conserve l'ordre des middlewares et le verbe", () => {
  const app = fakeApp();
  const requireAuth = named("requireAuth");
  const requirePermission = named("requirePermission");
  const updateStatus = named("updateStatus");
  const report = composeModules(app, [
    {
      id: "finance",
      status: "extracted",
      register(registry) {
        registry.patch("/api/finance/payment-statuses/:code", requireAuth, requirePermission, updateStatus);
      },
    },
  ]);
  assert.equal(report.routeCount, 1);
  assert.deepEqual(report.modules[0].routes[0].handlerNames, ["requireAuth", "requirePermission", "updateStatus"]);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].verb, "patch");
  assert.deepEqual(app.calls[0].handlers, [requireAuth, requirePermission, updateStatus]);
});

test("deux modules extraits s'enregistrent dans l'ordre du catalogue", () => {
  const app = fakeApp();
  const first = named("first");
  const second = named("second");
  const report = composeModules(app, [
    { id: "finance", status: "extracted", register(registry) { registry.get("/api/finance/a", first); } },
    { id: "students", status: "extracted", register(registry) { registry.get("/api/students", second); } },
  ]);
  assert.deepEqual(report.order, ["finance", "students"]);
  assert.deepEqual(app.calls.map((call) => call.path), ["/api/finance/a", "/api/students"]);
});

test("un module inline qui enregistre une route est refusé avant délégation", () => {
  const app = fakeApp();
  assert.throws(
    () => composeModules(app, [{
      id: "finance",
      status: "inline",
      register(registry) { registry.post("/api/finance/x", named("handler")); },
    }]),
    /inline/,
  );
  assert.equal(app.calls.length, 0);
});

test("un identifiant en double est refusé et le module suivant n'est pas chargé", () => {
  const app = fakeApp();
  let later = false;
  assert.throws(
    () => composeModules(app, [
      { id: "finance", status: "inline", register() {} },
      { id: "finance", status: "extracted", register() { later = true; } },
    ]),
    /déjà composé/,
  );
  assert.equal(later, false);
});

test("le registre n'expose pas use et refuse une chaîne vide", () => {
  const registry = createRouteRegistry(fakeApp(), { moduleId: "finance", allowRoutes: true });
  assert.equal(registry.use, undefined);
  assert.throws(() => registry.get("/api/finance/a"), /chaîne de fonctions/);
  assert.throws(() => registry.post("", named("handler")), /chemin de route vide/);
});

test("le contrôle CLI du catalogue se termine sans route ajoutée", () => {
  const script = path.resolve(__dirname, "../../scripts/mono-l0-module-load.js");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 route ajoutée/);
  assert.match(result.stdout, /finance → students → users → attendance → notes → planning → communications → administration → platform/);
});
