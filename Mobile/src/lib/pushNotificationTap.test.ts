import assert from "node:assert/strict";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  destinationFromPushResponse,
  dismissPendingPushNavigation,
  flushPendingPushNavigation,
  resetPushTapStateForTests,
} from "./pushNotificationTap";

function response(id: string, destination = "Home") {
  return {
    identifier: id,
    notification: {
      request: {
        identifier: id,
        content: { data: { somafrikDestination: destination } },
      },
    },
  };
}

function gate(authenticated: boolean, ready = true) {
  return {
    isAuthenticated: () => authenticated,
    isReady: () => ready,
  };
}

async function main() {
  resetPushTapStateForTests();
  const navigated: string[] = [];
  const navigate = (destination: string) => {
    navigated.push(destination);
  };

  const publicCold = await consumeInitialPushResponse(
    async () => response("cold-public", "Home"),
    navigate,
    gate(false, true),
  );
  assert.equal(publicCold, "queued");
  assert.deepEqual(navigated, [], "cold-start sans session : reste public");
  assert.equal(flushPendingPushNavigation(navigate, gate(false, true)), false);
  assert.equal(flushPendingPushNavigation(navigate, gate(true, true)), true);
  assert.deepEqual(navigated, ["Home"], "login ensuite : navigation Home une seule fois");

  const dupAfterLogin = consumePushTapResponse(response("cold-public"), navigate, gate(true));
  assert.equal(dupAfterLogin, "ignored");
  assert.equal(navigated.length, 1);

  resetPushTapStateForTests();
  navigated.length = 0;
  const authed = consumePushTapResponse(response("fg-1", "Home"), navigate, gate(true, true));
  assert.equal(authed, "navigated");
  assert.deepEqual(navigated, ["Home"], "notification avec session : navigation immédiate");

  const background = consumePushTapResponse(response("bg-1", "Home"), navigate, gate(true, true));
  assert.equal(background, "navigated");
  const dup = consumePushTapResponse(response("bg-1", "Home"), navigate, gate(true, true));
  assert.equal(dup, "ignored");
  assert.equal(navigated.length, 2, "réponse dupliquée : une seule navigation");

  resetPushTapStateForTests();
  navigated.length = 0;
  consumePushTapResponse(response("logout-old", "Home"), navigate, gate(true, true));
  assert.deepEqual(navigated, ["Home"]);
  dismissPendingPushNavigation();
  navigated.length = 0;
  const leftover = consumePushTapResponse(response("logout-old", "Home"), navigate, gate(false, true));
  assert.equal(leftover, "ignored");
  assert.equal(flushPendingPushNavigation(navigate, gate(true, true)), false);
  assert.deepEqual(navigated, [], "logout + ancien lastNotificationResponse : aucune navigation privée");

  resetPushTapStateForTests();
  navigated.length = 0;
  const unknown = destinationFromPushResponse(response("x", "https://evil.example"));
  assert.equal(unknown, "Home");
  const queuedUnknown = consumePushTapResponse(response("unknown-1", "Payments" as never), navigate, gate(false, true));
  assert.equal(queuedUnknown, "queued");
  assert.deepEqual(navigated, []);
  assert.equal(flushPendingPushNavigation(navigate, gate(true, true)), true);
  assert.deepEqual(navigated, ["Home"], "destination inconnue → Home seulement après authentification");

  resetPushTapStateForTests();
  navigated.length = 0;
  let ready = false;
  const coldQueued = await consumeInitialPushResponse(
    async () => response("cold-nav-not-ready"),
    navigate,
    gate(true, ready),
  );
  assert.equal(coldQueued, "queued");
  ready = true;
  assert.equal(flushPendingPushNavigation(navigate, { isAuthenticated: () => true, isReady: () => ready }), true);
  assert.deepEqual(navigated, ["Home"]);

  console.log("OK Mobile pushNotificationTap.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
