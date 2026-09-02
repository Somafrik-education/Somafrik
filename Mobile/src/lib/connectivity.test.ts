/**
 *   npx tsx Mobile/src/lib/connectivity.test.ts
 */
import assert from "node:assert/strict";
import {
  getConnectivityState,
  isOfflineContext,
  noteConnectivityFailure,
  noteConnectivitySuccess,
  probeConnectivity,
  resetConnectivityForTests,
  setConnectivityProbeForTests,
  setConnectivityStateForTests,
  subscribeConnectivity,
} from "./connectivity";

async function run() {
  resetConnectivityForTests();
  assert.equal(getConnectivityState(), "unknown");
  assert.equal(isOfflineContext(), false);

  const seen: string[] = [];
  const stop = subscribeConnectivity((state) => seen.push(state));
  noteConnectivityFailure(Object.assign(new Error("Connexion Internet indisponible."), { status: 0 }));
  assert.equal(getConnectivityState(), "offline");
  assert.equal(isOfflineContext(), true);
  noteConnectivitySuccess();
  assert.equal(getConnectivityState(), "online");
  assert.equal(isOfflineContext(), false);
  assert.ok(seen.includes("offline"));
  assert.ok(seen.includes("online"));
  stop();

  resetConnectivityForTests();
  let probes = 0;
  setConnectivityProbeForTests(async () => {
    probes += 1;
    return probes > 1;
  });
  assert.equal(await probeConnectivity(), false);
  assert.equal(getConnectivityState(), "offline");
  assert.equal(await probeConnectivity(), true);
  assert.equal(getConnectivityState(), "online");

  resetConnectivityForTests();
  noteConnectivityFailure(Object.assign(new Error("Délai de requête dépassé. Vérifiez votre réseau."), { code: "TIMEOUT" }));
  assert.notEqual(getConnectivityState(), "offline", "timeout ne marque pas offline");
  noteConnectivityFailure(Object.assign(new Error("backend_5xx"), { status: 500 }));
  assert.notEqual(getConnectivityState(), "offline", "5xx ne marque pas offline");
  setConnectivityProbeForTests(async () => {
    throw Object.assign(new Error("health"), { status: 503 });
  });
  assert.equal(await probeConnectivity(), false);
  assert.notEqual(getConnectivityState(), "offline", "sonde HTTP 5xx ne force pas offline");

  function transportError(code: string, message: string, status?: number) {
    return Object.assign(new Error(message), { code, status, name: "ApiClientError" });
  }

  resetConnectivityForTests();
  setConnectivityStateForTests("offline");
  setConnectivityProbeForTests(async () => {
    throw transportError("NETWORK_UNAVAILABLE", "Connexion Internet indisponible.", 0);
  });
  assert.equal(await probeConnectivity(), false, "offline + NETWORK_UNAVAILABLE → false");
  assert.equal(getConnectivityState(), "offline", "state reste offline");

  resetConnectivityForTests();
  setConnectivityStateForTests("offline");
  setConnectivityProbeForTests(async () => {
    throw transportError("TIMEOUT", "Délai de requête dépassé. Vérifiez votre réseau.");
  });
  assert.equal(await probeConnectivity(), false, "offline + TIMEOUT → false");
  assert.equal(getConnectivityState(), "offline", "timeout ne sort pas de offline");

  resetConnectivityForTests();
  setConnectivityStateForTests("offline");
  setConnectivityProbeForTests(async () => {
    throw transportError("backend_5xx", "health down", 500);
  });
  assert.equal(await probeConnectivity(), false, "offline + /health 500 → false");
  assert.equal(getConnectivityState(), "offline", "5xx ne sort pas de offline");

  resetConnectivityForTests();
  setConnectivityStateForTests("offline");
  setConnectivityProbeForTests(async () => true);
  assert.equal(await probeConnectivity(), true, "offline + /health 2xx → true");
  assert.equal(getConnectivityState(), "online", "2xx rétablit online");

  resetConnectivityForTests();
  console.log("connectivity.test.ts OK");
}

run().catch((error) => {
  resetConnectivityForTests();
  console.error(error);
  process.exit(1);
});
