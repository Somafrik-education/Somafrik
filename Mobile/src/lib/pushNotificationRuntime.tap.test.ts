import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  flushPendingPushNavigation,
  resetPushTapStateForTests,
} from "./pushNotificationTap";
import {
  callPushNavigationRef,
  dispatchRegisteredPushNavigation,
} from "./pushNotificationNavigate";
import type { AllowedPushDestination, AllowedPushNavigationParams } from "./pushNotificationDestinations";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

function tap(id: string, destination = "Home", extra: Record<string, unknown> = {}) {
  return {
    identifier: id,
    notification: {
      request: {
        identifier: id,
        content: { data: { somafrikDestination: destination, ...extra } },
      },
    },
  };
}

function isDeprecatedObjectNavigate(args: unknown[]) {
  return args.length === 1 && args[0] != null && typeof args[0] === "object" && "name" in (args[0] as object);
}

function makeRef(routeNames: string[], calls: unknown[][]) {
  return {
    isReady: () => true,
    getRootState: () => ({ routeNames, routes: routeNames.map((name) => ({ name })) }),
    navigate: (...args: never[]) => {
      calls.push(args);
    },
  };
}

async function main() {
  const runtimeSrc = readFileSync(path.join(here, "../components/PushNotificationsRuntime.tsx"), "utf8");
  const navigatorSrc = readFileSync(path.join(here, "../navigation/AppNavigator.tsx"), "utf8");
  const navigateSrc = readFileSync(path.join(here, "pushNotificationNavigate.ts"), "utf8");

  assert.match(runtimeSrc, /dispatchRegisteredPushNavigation/);
  assert.match(navigatorSrc, /dispatchRegisteredPushNavigation/);
  assert.match(runtimeSrc, /consumeInitialPushResponse/);
  assert.match(runtimeSrc, /addNotificationResponseReceivedListener/);
  assert.match(runtimeSrc, /flushPendingPushNavigation/);
  assert.match(navigatorSrc, /onReady/);
  assert.doesNotMatch(runtimeSrc, /navigate\(\{\s*name/);
  assert.doesNotMatch(navigatorSrc, /navigate\(\{\s*name/);
  assert.match(navigateSrc, /export function callPushNavigationRef/);
  assert.match(navigateSrc, /\(name, params\)/);
  assert.doesNotMatch(navigateSrc, /navigate\(\{ name, params \}\)/);

  const probe: unknown[][] = [];
  callPushNavigationRef((...args) => probe.push(args), "Home", undefined);
  assert.equal(
    isDeprecatedObjectNavigate(probe[0] ?? []),
    false,
    "chemin tap réel : navigate(name, params) — pas { name, params } (warning RN)",
  );
  assert.equal(typeof probe[0]?.[0], "string");
  assert.equal(probe[0]?.[0], "Home");

  resetPushTapStateForTests();
  const warmCalls: unknown[][] = [];
  const warmRef = makeRef(["Home", "StudentPayments", "Messages"], warmCalls);
  const warmGate = { isAuthenticated: () => true, isReady: () => true };
  const warmNavigate = (destination: AllowedPushDestination, params?: AllowedPushNavigationParams) => {
    dispatchRegisteredPushNavigation(warmRef, destination, params);
  };
  assert.equal(consumePushTapResponse(tap("warm-home", "Home"), warmNavigate, warmGate), "navigated");
  assert.equal(warmCalls.length, 1, "warm start Home : une seule navigation");
  assert.equal(isDeprecatedObjectNavigate(warmCalls[0] ?? []), false);
  assert.deepEqual(warmCalls[0]?.[0], "Home");

  resetPushTapStateForTests();
  const allowCalls: unknown[][] = [];
  const allowRef = makeRef(["Home", "StudentPayments"], allowCalls);
  assert.equal(
    consumePushTapResponse(
      tap("warm-pay", "StudentPayments", { somafrikStudentId: STUDENT_ID }),
      (destination, params) => dispatchRegisteredPushNavigation(allowRef, destination, params),
      warmGate,
    ),
    "navigated",
  );
  assert.equal(allowCalls.length, 1, "warm start allowlist : une seule navigation");
  assert.equal(allowCalls[0]?.[0], "StudentPayments");
  assert.equal((allowCalls[0]?.[1] as { studentId?: string } | undefined)?.studentId, STUDENT_ID);

  resetPushTapStateForTests();
  const fallbackCalls: unknown[][] = [];
  const fallbackRef = makeRef(["Home", "StudentPayments"], fallbackCalls);
  assert.equal(
    consumePushTapResponse(
      tap("invalid-dest", "https://evil.example"),
      (destination, params) => dispatchRegisteredPushNavigation(fallbackRef, destination, params),
      warmGate,
    ),
    "navigated",
  );
  assert.equal(fallbackCalls[0]?.[0], "Home", "destination invalide → Home");

  resetPushTapStateForTests();
  const coldCalls: unknown[][] = [];
  let ready = false;
  const coldRef = {
    isReady: () => ready,
    getRootState: () => ({ routeNames: ["Home", "StudentPayments"], routes: [{ name: "Home" }] }),
    navigate: (...args: never[]) => {
      coldCalls.push(args);
    },
  };
  const coldNavigate = (destination: AllowedPushDestination, params?: AllowedPushNavigationParams) => {
    dispatchRegisteredPushNavigation(coldRef, destination, params);
  };
  const coldQueued = await consumeInitialPushResponse(
    async () => tap("cold-home", "Home"),
    coldNavigate,
    { isAuthenticated: () => true, isReady: () => ready },
  );
  assert.equal(coldQueued, "queued");
  assert.equal(coldCalls.length, 0, "cold-ish start avant onReady : aucune navigation");
  ready = true;
  assert.equal(
    flushPendingPushNavigation(coldNavigate, { isAuthenticated: () => true, isReady: () => ready }),
    true,
  );
  assert.equal(flushPendingPushNavigation(coldNavigate, { isAuthenticated: () => true, isReady: () => ready }), false);
  assert.equal(coldCalls.length, 1, "onReady + flush canonique : une seule navigation");
  assert.equal(isDeprecatedObjectNavigate(coldCalls[0] ?? []), false);
  assert.equal(coldCalls[0]?.[0], "Home");

  resetPushTapStateForTests();
  const dupCalls: unknown[][] = [];
  const dupRef = makeRef(["Home"], dupCalls);
  const dupNavigate = (destination: AllowedPushDestination, params?: AllowedPushNavigationParams) => {
    dispatchRegisteredPushNavigation(dupRef, destination, params);
  };
  await consumeInitialPushResponse(async () => tap("same-id", "Home"), dupNavigate, warmGate);
  assert.equal(consumePushTapResponse(tap("same-id", "Home"), dupNavigate, warmGate), "ignored");
  assert.equal(dupCalls.length, 1, "cold getLast + listener : déduplication, une navigation");

  console.log("OK Mobile pushNotificationRuntime.tap.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
