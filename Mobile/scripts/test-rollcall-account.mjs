/**
 * Node oracle for Mobile HMAC account scoping.
 * The temporary entry rewrites only an extensionless TS import for Node; Metro keeps
 * the original module. CI removes the temporary file in all cases.
 */
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/offline/rollCall");
const source = fs.readFileSync(path.join(folder, "accountPartition.ts"), "utf8");
assert.ok(source.includes('from "./jcs"'));
const temp = path.join(folder, "__account_partition_node_gate__.ts");
fs.writeFileSync(temp, source.replace('from "./jcs"', 'from "./jcs.ts"'));
try {
  const { resolveRollCallAccount, hmacSha256, base64url } = await import(pathToFileURL(temp).href);
  const { lp } = await import(pathToFileURL(path.join(folder, "jcs.ts")).href);
  const sha = async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());
  const salt = Uint8Array.from({length:32}, (_,i) => i);
  const accountA = {
    environmentId:"preproduction-8ac37e1c",
    schoolId:"00000000-0000-4000-8000-000000000001",
    userId:"00000000-0000-4000-8000-000000000002",
  };
  const accountB = {
    ...accountA,
    userId:"00000000-0000-4000-8000-000000000003",
  };
  const a = await resolveRollCallAccount(accountA, salt, sha);
  const b = await resolveRollCallAccount(accountB, salt, sha);
  const prod = await resolveRollCallAccount({...accountA,environmentId:"production-8ac37e1c"}, salt, sha);
  const rotated = await resolveRollCallAccount(accountA, Uint8Array.from(salt).reverse(), sha);
  assert.deepEqual(a, await resolveRollCallAccount(accountA, salt, sha));
  assert.notEqual(a.accountId,b.accountId);
  assert.notEqual(a.accountId,prod.accountId);
  assert.notEqual(a.accountId,rotated.accountId);
  assert.match(a.accountId,/^[A-Za-z0-9_-]{23}$/);
  assert.match(a.fileName,/^somafrik-rollcall-v1-preproduction-8ac37e1c-[A-Za-z0-9_-]{23}\.db$/);
  assert.ok(!a.fileName.includes(accountA.userId) && !a.fileName.includes(accountA.schoolId));
  assert.ok(!a.keyName.includes(accountA.userId) && !a.keyName.includes(accountA.schoolId));
  const bytes = lp(["somafrik.rc-offline.account.v1",accountA.environmentId,accountA.userId,accountA.schoolId]);
  const expected = createHmac("sha256",Buffer.from(salt)).update(bytes).digest("base64url").slice(0,23);
  assert.equal(a.accountId,expected);
  const hmac = await hmacSha256(salt,new Uint8Array([1,2,3,4]),sha);
  assert.equal(Buffer.from(hmac).toString("hex"),
    createHmac("sha256",Buffer.from(salt)).update(Buffer.from([1,2,3,4])).digest("hex"));
  assert.equal(base64url(new Uint8Array([255,255,255,254])),"____ _g".replace(" ",""));
  await assert.rejects(resolveRollCallAccount(accountA,new Uint8Array(31),sha),/RC_ACCOUNT_SCOPE_INVALID/);
  await assert.rejects(resolveRollCallAccount({...accountA,environmentId:"preprod/../prod"},salt,sha),/RC_ACCOUNT_SCOPE_INVALID/);
  console.log("PASS: account HMAC partitioning / cross-account / cross-env / invalid scope (native NOT tested)");
} finally {
  fs.rmSync(temp,{force:true});
}
