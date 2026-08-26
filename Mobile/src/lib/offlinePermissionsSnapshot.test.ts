/**
 * P1-RC1-OFFLINE-01 — boot offline fail-closed + snapshot autoritatif.
 *   npx tsx Mobile/src/lib/offlinePermissionsSnapshot.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION,
  assertAuthoritativeOfflineSnapshot,
  buildEffectivePermissionsSnapshotV1,
  decidePermissionsRefreshFailure,
  parseEffectivePermissionsSnapshotV1,
  permissionsListsEqual,
  snapshotFromPersistedProfile,
  snapshotMatchesSession,
} from "./offlinePermissionsSnapshot";
import {
  createEffectivePermissionsRefresher,
  isMetierRenderable,
  type PermissionsBootstrapState,
  type RefreshableSession,
} from "./livePermissionsRefresh";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import { hasSecurityPermission } from "../domain/security/permissions";
import { enqueueOutbox, listOutbox, setOutboxStorageForTests } from "./outbox";

function sessionOf(input: {
  id: string;
  permissions: string[] | undefined;
  roleKeys?: string[];
  role?: string;
  schoolCode?: string;
  schoolId?: string;
}): RefreshableSession {
  return attachCanonicalRoleIdentity({
    role: input.role ?? "teacher",
    permissions: input.permissions,
    roleKeys: input.roleKeys,
    school: input.schoolId || input.schoolCode
      ? { id: input.schoolId, code: input.schoolCode ?? "CD-IN-26-001" }
      : undefined,
    user: {
      id: input.id,
      name: input.id,
      schoolCode: input.schoolCode ?? "CD-IN-26-001",
      schoolId: input.schoolId,
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  }) as RefreshableSession;
}

function networkUnavailable() {
  return Object.assign(new Error("Connexion Internet indisponible. Réessayez lorsque le réseau sera rétabli."), {
    status: 0,
    code: "NETWORK_UNAVAILABLE",
    name: "ApiClientError",
  });
}

function makeHarness(initial: RefreshableSession | null, snapshotPermissions?: string[]) {
  let session: RefreshableSession | null = initial;
  let bootstrap: PermissionsBootstrapState = initial ? "loading" : "idle";
  let error: string | null = null;
  let snapshot = initial
    ? buildEffectivePermissionsSnapshotV1({
        session: initial,
        permissions: snapshotPermissions ?? (Array.isArray(initial.permissions) ? initial.permissions : []),
        roleKeys: initial.roleKeys,
        resolvedAt: "2026-08-26T00:00:00.000Z",
      })
    : null;
  let fetchImpl: () => Promise<{ permissions?: string[]; roleKeys?: string[]; resolvedAt?: string }> = async () => ({
    permissions: [],
  });

  const refresher = createEffectivePermissionsRefresher({
    getSession: () => session,
    applySession: (next) => {
      session = next;
    },
    fetchEffectivePermissions: () => fetchImpl(),
    getOfflineSnapshot: () => snapshot,
    persistOfflineSnapshot: (next) => {
      snapshot = next;
    },
    onAuthFailure: () => {
      session = null;
      snapshot = null;
      bootstrap = "idle";
      error = null;
    },
    onBootstrap: (state, message) => {
      bootstrap = state;
      error = message;
    },
  });

  return {
    refresher,
    setFetch: (next: typeof fetchImpl) => {
      fetchImpl = next;
    },
    get session() {
      return session;
    },
    set session(next) {
      session = next;
    },
    get bootstrap() {
      return bootstrap;
    },
    get error() {
      return error;
    },
    get snapshot() {
      return snapshot;
    },
    set snapshot(next) {
      snapshot = next;
    },
  };
}

async function run() {
  const teacherPerms = ["Présences:CREATE", "Présences:READ"];
  const session = sessionOf({
    id: "teacher-1",
    permissions: teacherPerms,
    roleKeys: ["TEACHER"],
    schoolCode: "CD-IN-26-001",
    schoolId: "sch-1",
  });
  const snapshot = buildEffectivePermissionsSnapshotV1({
    session,
    permissions: teacherPerms,
    roleKeys: ["TEACHER"],
    resolvedAt: "2026-08-26T00:00:00.000Z",
  });
  assert.ok(snapshot);
  assert.equal(snapshot.schemaVersion, EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION);

  // CAS 1 — session + snapshot valides + network error → ready_offline
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => {
      throw networkUnavailable();
    });
    const ok = await harness.refresher.refresh();
    assert.equal(ok, false);
    assert.equal(harness.bootstrap, "ready_offline");
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), true);
    assert.deepEqual(harness.session?.permissions, teacherPerms);
    assertAuthoritativeOfflineSnapshot(harness.snapshot!, teacherPerms);
  }

  // CAS 2 — permissions absentes + network error → fail-closed
  {
    const bare = sessionOf({ id: "teacher-1", permissions: undefined as unknown as string[], roleKeys: ["TEACHER"] });
    const harness = makeHarness(bare);
    harness.snapshot = null;
    harness.setFetch(async () => {
      throw networkUnavailable();
    });
    await harness.refresher.refresh();
    assert.equal(harness.bootstrap, "error");
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), false);
  }

  // CAS 3 — mismatch userId
  {
    const decision = decidePermissionsRefreshFailure({
      error: networkUnavailable(),
      session: sessionOf({ id: "teacher-2", permissions: teacherPerms, schoolCode: "CD-IN-26-001" }),
      snapshot: snapshot!,
    });
    assert.equal(decision.action, "error");
    assert.match(decision.action === "error" ? decision.reason : "", /incohérent/);
  }

  // CAS 4 — mismatch tenant
  {
    const decision = decidePermissionsRefreshFailure({
      error: networkUnavailable(),
      session: sessionOf({
        id: "teacher-1",
        permissions: teacherPerms,
        schoolCode: "CD-OTHER-26-009",
        schoolId: "sch-other",
      }),
      snapshot: snapshot!,
    });
    assert.equal(decision.action, "error");
  }

  // CAS 5 — 401 purge
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => {
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    });
    await harness.refresher.refresh();
    assert.equal(harness.session, null);
    assert.equal(harness.snapshot, null);
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), false);
  }

  // CAS 6 — 403 purge
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    await harness.refresher.refresh();
    assert.equal(harness.session, null);
    assert.equal(harness.snapshot, null);
  }

  // CAS 7 — payload invalide, même hors-ligne, pas de fallback
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => ({ permissions: undefined }));
    await harness.refresher.refresh();
    assert.equal(harness.bootstrap, "error");
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), false);
    assert.deepEqual(harness.session?.permissions, teacherPerms);
  }

  // Timeout / 5xx ne sont pas un fallback offline
  {
    const timeoutDecision = decidePermissionsRefreshFailure({
      error: Object.assign(new Error("Délai de requête dépassé. Vérifiez votre réseau."), {
        code: "TIMEOUT",
      }),
      session,
      snapshot,
    });
    assert.equal(timeoutDecision.action, "error");
    const fiveXx = decidePermissionsRefreshFailure({
      error: Object.assign(new Error("bad gateway"), { status: 502 }),
      session,
      snapshot,
    });
    assert.equal(fiveXx.action, "error");
  }

  // CAS 8 — permissions identiques au snapshot, aucune expansion
  {
    const defaults = getInternalRoleDefaults("Enseignant");
    assert.ok(Array.isArray(defaults));
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => {
      throw networkUnavailable();
    });
    await harness.refresher.refresh();
    assert.equal(permissionsListsEqual(harness.session?.permissions, teacherPerms), true);
    assert.equal((harness.session?.permissions ?? []).includes("ALL_PRIVILEGES"), false);
    for (const extra of defaults) {
      if (!teacherPerms.includes(extra)) {
        assert.equal((harness.session?.permissions ?? []).includes(extra), false);
      }
    }
  }

  // CAS 9 — réseau revient, live remplace snapshot
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => ({
      permissions: ["Présences:READ"],
      roleKeys: ["TEACHER"],
      resolvedAt: "2026-08-26T01:00:00.000Z",
    }));
    const ok = await harness.refresher.refresh();
    assert.equal(ok, true);
    assert.equal(harness.bootstrap, "ready");
    assert.deepEqual(harness.session?.permissions, ["Présences:READ"]);
    assert.deepEqual(harness.snapshot?.permissions, ["Présences:READ"]);
  }

  // CAS 10 — révocation après retour réseau
  {
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => ({ permissions: [], roleKeys: ["TEACHER"] }));
    await harness.refresher.refresh();
    assert.deepEqual(harness.session?.permissions, []);
    assert.equal(hasSecurityPermission(harness.session, "Présences", "CREATE"), false);
    assert.equal(hasSecurityPermission(harness.session, "Présences", "READ"), false);
  }

  // CAS 11 — logout / parse null invalidates snapshot
  {
    assert.equal(parseEffectivePermissionsSnapshotV1(null), null);
    assert.equal(
      parseEffectivePermissionsSnapshotV1({
        schemaVersion: 1,
        userId: "x",
        schoolCode: "CD-IN-26-001",
        permissions: teacherPerms,
        roleKeys: ["TEACHER"],
        resolvedAt: "t",
        accessToken: "should-reject",
      }),
      null,
    );
    const fromProfile = snapshotFromPersistedProfile(session);
    assert.ok(fromProfile);
    assert.equal(snapshotMatchesSession(fromProfile, session), true);
  }

  // CAS 12 — outbox lisible si boot offline rendable
  {
    const memory: { entries: unknown[] } = { entries: [] };
    setOutboxStorageForTests({
      async read() {
        return JSON.parse(JSON.stringify(memory.entries));
      },
      async write(entries) {
        memory.entries = JSON.parse(JSON.stringify(entries));
      },
    });
    await enqueueOutbox({
      domain: "presences",
      method: "POST",
      path: "/presences",
      payload: { classId: "cls-1" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "teacher-1",
      schoolScope: "CD-IN-26-001",
    });
    const harness = makeHarness(session, teacherPerms);
    harness.setFetch(async () => {
      throw networkUnavailable();
    });
    await harness.refresher.refresh();
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), true);
    const pending = await listOutbox();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.domain, "presences");
    assert.equal(pending[0]?.status, "pending");
  }

  // Garde-fou sécurité : pas de roleDefaults / ALL inventé dans le module snapshot
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "offlinePermissionsSnapshot.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    assert.doesNotMatch(source, /getInternalRoleDefaults/);
    assert.doesNotMatch(source, /ALL_PRIVILEGES/);
    assert.doesNotMatch(source, /roleDefaults/);
    assert.doesNotMatch(source, /school_admin\s*=>/);
    assert.doesNotMatch(source, /if\s*\(\s*offline[\s\S]{0,80}permissions\s*=/);
  }

  console.log("offlinePermissionsSnapshot.test.ts OK");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
