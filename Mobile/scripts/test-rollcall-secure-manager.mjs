/**
 * Injected SQLite mock for PR2 secure manager. The cipher_version response is simulated:
 * THIS TEST DOES NOT DEMONSTRATE NATIVE AT-REST ENCRYPTION.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/offline/rollCall");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-rc-"));
const generatedPartition = path.join(folder, "__account_partition_secure_test__.ts");
const generatedManager = path.join(folder, "__secure_manager_node_test__.ts");
const partitionSource = fs.readFileSync(path.join(folder,"accountPartition.ts"),"utf8");
const managerSource = fs.readFileSync(path.join(folder,"secureManager.ts"),"utf8");
fs.writeFileSync(generatedPartition, partitionSource.replace('from "./jcs"', 'from "./jcs.ts"'));
fs.writeFileSync(generatedManager, managerSource
  .replace('from "./accountPartition"', 'from "./__account_partition_secure_test__.ts"')
  .replace('from "./schema"', 'from "./schema.ts"'));
try {
  const {createRollCallSecureManager} = await import(pathToFileURL(generatedManager).href);
  const keys = new Map();
  const events = [];
  let saltCalls = 0;
  const mockFile = (name) => path.join(tempRoot, name);
  const secure = {
    get: async (name) => keys.get(name) ?? null,
    put: async (name,value) => { keys.set(name,value); events.push("put:"+name); },
    remove: async (name) => { keys.delete(name); events.push("key-delete:"+name); },
  };
  const files = {
    exists: async (name) => fs.existsSync(mockFile(name)),
    remove: async (name) => {
      events.push("file-delete:"+name);
      fs.rmSync(mockFile(name),{force:true});
    },
    quarantine: async (name) => {
      events.push("quarantine:"+name);
      fs.renameSync(mockFile(name),mockFile(name+".quarantine"));
    },
    hasAnyRollCallDatabase: async () =>
      fs.readdirSync(tempRoot).some((x) => x.startsWith("somafrik-rollcall-v1-") && x.endsWith(".db")),
  };
  const connections = [];
  const deps = {
    secure,files,
    randomBytes: async (n) => {
      saltCalls++;
      return Uint8Array.from({length:n}, (_,i) => (i+saltCalls)%256);
    },
    sha256: async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
    openDatabase: async (name) => {
      const db = new DatabaseSync(mockFile(name));
      const conn = {
        execAsync: async (sql) => db.exec(sql),
        getFirstAsync: async (sql, params=[]) => {
          if (sql === "PRAGMA cipher_version") return {cipher_version:"4.7.0-TEST-ONLY"};
          return db.prepare(sql).get(...params) ?? null;
        },
        closeAsync: async () => db.close(),
      };
      connections.push(conn);
      return conn;
    },
  };
  const manager = createRollCallSecureManager(deps);
  const A = {
    environmentId:"production-test1",
    userId:"00000000-0000-4000-8000-000000000002",
    schoolId:"00000000-0000-4000-8000-000000000001",
  };
  const B = {...A,userId:"00000000-0000-4000-8000-000000000003"};
  const first = await manager.open(A);
  assert.ok(await files.exists(first.fileName));
  assert.equal(keys.size,2,"one salt and one account key");
  const same = await manager.open(A);
  assert.equal(same.db,first.db,"same account reuses its connection");
  const second = await manager.open(B);
  assert.notEqual(second.fileName,first.fileName,"another account gets another file");
  assert.ok(await files.exists(first.fileName));
  assert.ok(await files.exists(second.fileName));
  assert.equal(keys.size,3);
  const again = await manager.open(A);
  assert.equal(again.fileName,first.fileName);
  assert.ok(again.db!==first.db,"reopen after account switch");
  await manager.close();
  const bKey = [...keys.keys()].find((name) => name.includes(second.accountId));
  assert.ok(bKey);
  keys.delete(bKey);
  await assert.rejects(manager.open(B),(e) => e.code === "RC_DATABASE_KEY_LOST");
  assert.ok(!await files.exists(second.fileName));
  assert.ok(fs.existsSync(mockFile(second.fileName+".quarantine")));
  const keyA = [...keys.keys()].find((name) => name.includes(first.accountId));
  assert.ok(keyA);
  await manager.cryptoErase(A);
  assert.equal(keys.has(keyA),false);
  assert.equal(await files.exists(first.fileName),false);
  const eraseKeyIndex = events.findIndex((x)=>x==="key-delete:"+keyA);
  const eraseFileIndex = events.findIndex((x)=>x==="file-delete:"+first.fileName);
  assert.ok(eraseKeyIndex>=0 && eraseFileIndex>eraseKeyIndex,
    "crypto-erase removes SecureStore key before file");
  keys.delete("somafrik.rollCallDeviceSaltV1");
  fs.writeFileSync(mockFile("somafrik-rollcall-v1-orphan.db"),"unreadable");
  await assert.rejects(manager.open(A),(e) => e.code === "RC_ACCOUNT_SALT_LOST");
  assert.equal(keys.has("somafrik.rollCallDeviceSaltV1"),false,"no silent salt regeneration");
  // Initial database-open failure must not strand a freshly generated encryption key.
  const C = {...A,userId:"00000000-0000-4000-8000-000000000004"};
  const failing = createRollCallSecureManager({
    ...deps,
    openDatabase: async () => { throw new Error("SIMULATED_OPEN_FAILURE"); },
  });
  const keysBeforeFailure = new Set(keys.keys());
  await assert.rejects(failing.open(C), /SIMULATED_OPEN_FAILURE/);
  assert.deepEqual(new Set(keys.keys()), keysBeforeFailure,
    "failed initial open must remove its newly generated account key");
  console.log("PASS: account SQLCipher manager lifecycle simulated; NATIVE SQLCIPHER NOT VERIFIED");
} finally {
  fs.rmSync(generatedManager,{force:true});
  fs.rmSync(generatedPartition,{force:true});
  fs.rmSync(tempRoot,{recursive:true,force:true});
}
