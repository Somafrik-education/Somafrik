import assert from "node:assert/strict";
import {
  applyLivePermissionsToSession,
  createEffectivePermissionsRefresher,
  createRefreshGate,
  isMetierRenderable,
  planForegroundRefresh,
  shouldRefreshPermissionsOnAppStateChange,
  type PermissionsBootstrapState,
  type RefreshableSession,
} from "./livePermissionsRefresh";
import { canReadRoute, hasSecurityPermission } from "../domain/security/permissions";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";

function sessionOf(input: {
  id: string;
  permissions: string[];
  roleKeys?: string[];
  role?: string;
}): RefreshableSession {
  return attachCanonicalRoleIdentity({
    role: input.role ?? "principal",
    permissions: input.permissions,
    roleKeys: input.roleKeys,
    user: {
      id: input.id,
      name: input.id,
      schoolCode: "CD-IN-26-001",
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  }) as RefreshableSession;
}

assert.equal(shouldRefreshPermissionsOnAppStateChange("active", "active"), false);
assert.equal(shouldRefreshPermissionsOnAppStateChange(null, "active"), false);
assert.equal(shouldRefreshPermissionsOnAppStateChange("background", "active"), true);
assert.equal(shouldRefreshPermissionsOnAppStateChange("inactive", "active"), true);
assert.equal(shouldRefreshPermissionsOnAppStateChange("active", "background"), false);
assert.equal(planForegroundRefresh({ previous: "background", next: "active", hasSession: false }), "skip");
assert.equal(planForegroundRefresh({ previous: "background", next: "active", hasSession: true }), "refresh");
assert.equal(planForegroundRefresh({ previous: "active", next: "active", hasSession: true }), "skip");

let tracked: "background" | "active" = "background";
assert.equal(shouldRefreshPermissionsOnAppStateChange(tracked, "active"), true);
tracked = "active";
assert.equal(shouldRefreshPermissionsOnAppStateChange(tracked, "active"), false, "double foreground : un seul refresh");

const revoked = applyLivePermissionsToSession(
  sessionOf({ id: "u-a", permissions: ["Élèves:READ"], roleKeys: ["PRINCIPAL"] }),
  { permissions: [] },
);
assert.deepEqual(revoked.permissions, []);
assert.equal(revoked.permissions?.includes("Élèves:READ"), false);
assert.equal(hasSecurityPermission(revoked, "Élèves", "READ"), false);
assert.equal(canReadRoute(revoked, "Students"), false);
assert.equal(isMetierRenderable(revoked, "loading"), false);

const granted = applyLivePermissionsToSession(
  sessionOf({ id: "u-a", permissions: [], roleKeys: ["PRINCIPAL"] }),
  { permissions: ["Élèves:READ"] },
);
assert.deepEqual(granted.permissions, ["Élèves:READ"]);
assert.equal(hasSecurityPermission(granted, "Élèves", "READ"), true);
assert.equal(canReadRoute(granted, "Students"), true);

const multi = applyLivePermissionsToSession(
  sessionOf({
    id: "u-a",
    permissions: ["Élèves:READ", "Notes:READ"],
    roleKeys: ["PRINCIPAL", "TEACHER"],
  }),
  { permissions: ["Notes:READ"], roleKeys: ["TEACHER"] },
);
assert.deepEqual(multi.roleKeys, ["TEACHER"]);
assert.deepEqual(multi.user?.roleKeys, ["TEACHER"]);
assert.equal(multi.roleKey, "TEACHER");
assert.equal((multi.roleKeys ?? []).includes("PRINCIPAL"), false);
assert.deepEqual(multi.permissions, ["Notes:READ"]);

function makeHarness(initial: RefreshableSession | null) {
  let session: RefreshableSession | null = initial;
  let bootstrap: PermissionsBootstrapState = initial ? "ready" : "idle";
  let error: string | null = null;
  let fetchCount = 0;
  let fetchImpl: () => Promise<{ permissions?: string[]; roleKeys?: string[] }> = async () => ({
    permissions: [],
  });

  const refresher = createEffectivePermissionsRefresher({
    getSession: () => session,
    applySession: (next) => {
      session = next;
    },
    fetchEffectivePermissions: async () => {
      fetchCount += 1;
      return fetchImpl();
    },
    onAuthFailure: () => {
      session = null;
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
    get fetchCount() {
      return fetchCount;
    },
  };
}

async function main() {
  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: ["Élèves:READ"] }));
    harness.setFetch(async () => ({ permissions: [] }));
    const ok = await harness.refresher.refresh();
    assert.equal(ok, true);
    assert.equal(harness.bootstrap, "ready");
    assert.deepEqual(harness.session?.permissions, []);
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), true);
    assert.equal(canReadRoute(harness.session, "Students"), false);
  }

  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: [] }));
    harness.setFetch(async () => ({ permissions: ["Élèves:READ"] }));
    await harness.refresher.refresh();
    assert.equal(canReadRoute(harness.session, "Students"), true);
    assert.equal(hasSecurityPermission(harness.session, "Élèves", "READ"), true);
  }

  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: ["Utilisateurs:UPDATE"] }));
    harness.setFetch(async () => {
      throw new Error("network down");
    });
    const ok = await harness.refresher.refresh();
    assert.equal(ok, false);
    assert.equal(harness.bootstrap, "error");
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), false);
    assert.equal(hasSecurityPermission(harness.session, "Utilisateurs", "UPDATE"), true, "snapshot mémoire inchangé");
  }

  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: ["Utilisateurs:UPDATE"] }));
    harness.setFetch(async () => {
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    });
    await harness.refresher.refresh();
    assert.equal(harness.session, null);
    assert.equal(isMetierRenderable(harness.session, harness.bootstrap), false);
  }

  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: ["Utilisateurs:UPDATE"] }));
    harness.setFetch(async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    await harness.refresher.refresh();
    assert.equal(harness.session, null);
  }

  {
    const harness = makeHarness(
      sessionOf({
        id: "u-a",
        permissions: ["Élèves:READ"],
        roleKeys: ["PRINCIPAL", "TEACHER"],
      }),
    );
    harness.setFetch(async () => ({ permissions: ["Notes:READ"], roleKeys: ["TEACHER"] }));
    await harness.refresher.refresh();
    assert.deepEqual(harness.session?.roleKeys, ["TEACHER"]);
    assert.equal(harness.session?.roleKey, "TEACHER");
    assert.deepEqual(harness.session?.permissions, ["Notes:READ"]);
    assert.equal(canReadRoute(harness.session, "Students"), false);
    assert.equal(canReadRoute(harness.session, "TeacherGrades"), true);
  }

  {
    let resolveA: (value: { permissions: string[] }) => void = () => undefined;
    const harness = makeHarness(sessionOf({ id: "user-a", permissions: ["Élèves:READ"] }));
    harness.setFetch(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    const pendingA = harness.refresher.refresh();
    harness.session = sessionOf({ id: "user-b", permissions: [] });
    harness.refresher.invalidate();
    harness.setFetch(async () => ({ permissions: ["Messages:READ"] }));
    await harness.refresher.refresh();
    resolveA({ permissions: ["Élèves:READ", "Utilisateurs:UPDATE"] });
    await pendingA;
    assert.equal(harness.session?.user?.id, "user-b");
    assert.deepEqual(harness.session?.permissions, ["Messages:READ"]);
    assert.equal((harness.session?.permissions ?? []).includes("Utilisateurs:UPDATE"), false);
  }

  {
    const harness = makeHarness(sessionOf({ id: "u-a", permissions: ["Élèves:READ"] }));
    let started = 0;
    let release: () => void = () => undefined;
    harness.setFetch(
      () =>
        new Promise((resolve) => {
          started += 1;
          release = () => resolve({ permissions: ["Notes:READ"] });
        }),
    );
    const first = harness.refresher.refresh();
    const second = harness.refresher.refresh();
    assert.equal(started, 1, "deux foreground consécutifs : une seule requête");
    release();
    await Promise.all([first, second]);
    assert.equal(harness.fetchCount, 1);
    assert.deepEqual(harness.session?.permissions, ["Notes:READ"]);
  }

  {
    const gate = createRefreshGate();
    const first = gate.begin("u1", async () => true);
    const second = gate.begin("u1", async () => true);
    assert.equal(first, second);
    await first;
  }

  console.log("mobileLivePermissionsRefresh.test.ts OK");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
