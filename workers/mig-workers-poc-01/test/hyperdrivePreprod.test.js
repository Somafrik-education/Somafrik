import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertPocConnectionString } from "../src/transaction.js";

test("preprod Hyperdrive: guard base et rôle restreints", () => {
  assert.equal(
    assertPocConnectionString(
      "postgres://somafrik_hyperdrive_poc:fake@proxy.example:5432/postgres",
      "supabase-preprod-hyperdrive",
    ),
    "postgres",
  );
  assert.throws(
    () => assertPocConnectionString("postgres://proxy_user:fake@proxy.example:5432/", "supabase-preprod-hyperdrive"),
    /POC_DATABASE_TARGET_REFUSED/,
  );
  // Le proxy Hyperdrive ne reprend pas nécessairement le rôle réel.
  assert.equal(
    assertPocConnectionString("postgres://proxy_user:fake@proxy.example:5432/postgres", "supabase-preprod-hyperdrive"),
    "postgres",
  );
  assert.throws(
    () => assertPocConnectionString(
      "postgres://somafrik_hyperdrive_poc:fake@db.scdrdxqqshmvmogcmmdw.supabase.co/postgres",
      "local",
    ),
    /POC_DATABASE_HOST_REFUSED/,
  );
  assert.throws(
    () => assertPocConnectionString("postgres://x:y@localhost:5432/postgres", "unknown"),
    /POC_DATABASE_TARGET_REFUSED/,
  );
});

test("binding preprod: aucun nom de prod, cache/couplage absent", () => {
  const raw = readFileSync(new URL("../wrangler.hyperdrive-preprod.jsonc", import.meta.url), "utf8");
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(cfg.hyperdrive[0].id, "81eb6233ead64dcba878bd31cab644bf");
  assert.equal(cfg.vars.POC_DB_TARGET, "supabase-preprod-hyperdrive");
  assert.equal(cfg.workers_dev, true);
  assert.equal(cfg.queues, undefined);
  assert.equal(cfg.browser, undefined);
  assert.equal(cfg.routes, undefined);
  assert.doesNotMatch(raw, /loyubruyrxcaeshonkwp|db\.loyubruyrxcaeshonkwp/);
});
