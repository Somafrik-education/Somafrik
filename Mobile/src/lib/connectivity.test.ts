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
  console.log("connectivity.test.ts OK");
}

run().catch((error) => {
  resetConnectivityForTests();
  console.error(error);
  process.exit(1);
});
