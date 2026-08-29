import assert from "node:assert/strict";
import {
  consumeInitialPushResponse,
  consumePushTapResponse,
  destinationFromPushResponse,
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

async function main() {
  resetPushTapStateForTests();
  const navigated: string[] = [];
  const navigate = (destination: string) => {
    navigated.push(destination);
  };

  const foreground = consumePushTapResponse(response("fg-1", "Home"), navigate, () => true);
  assert.equal(foreground, "navigated");
  assert.deepEqual(navigated, ["Home"]);

  const background = consumePushTapResponse(response("bg-1", "Home"), navigate, () => true);
  assert.equal(background, "navigated");
  assert.deepEqual(navigated, ["Home", "Home"]);

  const dup = consumePushTapResponse(response("bg-1", "Home"), navigate, () => true);
  assert.equal(dup, "ignored");
  assert.equal(navigated.length, 2, "réponse dupliquée : une seule navigation");

  resetPushTapStateForTests();
  navigated.length = 0;
  const unknown = destinationFromPushResponse(response("x", "https://evil.example"));
  assert.equal(unknown, "Home");

  let ready = false;
  const cold = await consumeInitialPushResponse(
    async () => response("cold-1", "Payments" as never),
    navigate,
    () => ready,
  );
  assert.equal(cold, "queued");
  assert.deepEqual(navigated, []);
  assert.equal(flushPendingPushNavigation(navigate, () => ready), false);
  ready = true;
  assert.equal(flushPendingPushNavigation(navigate, () => ready), true);
  assert.deepEqual(navigated, ["Home"], "cold start : destination inconnue => Home, appliquée quand ready");

  const again = consumePushTapResponse(response("cold-1"), navigate, () => true);
  assert.equal(again, "ignored");
  assert.equal(navigated.length, 1);

  console.log("OK Mobile pushNotificationTap.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
