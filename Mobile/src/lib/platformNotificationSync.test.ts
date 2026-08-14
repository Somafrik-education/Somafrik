/**
 * LOT 6 Mobile — notifications plateforme : ID PostgreSQL canonique.
 *   npx tsx Mobile/src/lib/platformNotificationSync.test.ts
 */
import assert from "node:assert/strict";
import {
  applyCreatedPlatformNotification,
  applyReadPlatformNotification,
  buildPlatformNotificationCreatePayload,
  buildPlatformNotificationReadPatch,
  isUnreadNotification,
  resolveMarkReadTargetId,
} from "./platformNotificationSync";
import type { PlatformNotification } from "./scope";

function sample(overrides: Partial<PlatformNotification> = {}): PlatformNotification {
  return {
    title: "Alerte",
    message: "Test",
    type: "Information",
    status: "Non lu",
    ...overrides,
  };
}

function run() {
  const clientId = "ntf-1700000000000-deadbeef";
  const serverId = "550e8400-e29b-41d4-a716-446655440099";

  const payload = buildPlatformNotificationCreatePayload(
    sample({ id: clientId, title: "Nouvelle" }),
  );
  assert.equal("id" in payload, false);

  const created = sample({ id: serverId, title: "Nouvelle", status: "Non lu" });
  const merged = applyCreatedPlatformNotification(
    [sample({ id: clientId }), sample({ id: "other", title: "Autre" })],
    created,
    clientId,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, serverId);
  assert.ok(!merged.some((row) => row.id === clientId));

  const markReadId = resolveMarkReadTargetId(created, clientId);
  assert.equal(markReadId, serverId);

  const { id: patchId, patch } = buildPlatformNotificationReadPatch(created);
  assert.equal(patchId, serverId);
  assert.deepEqual(patch, { status: "Lu" });

  assert.throws(
    () => buildPlatformNotificationReadPatch(sample({ id: clientId })),
    /PLATFORM_NOTIFICATION_SERVER_ID_REQUIRED/,
  );

  const readBack = applyReadPlatformNotification(
    [created, sample({ id: "other-2", title: "B" })],
    { ...created, status: "Lu" },
  );
  assert.equal(readBack[0]?.status, "Lu");
  assert.equal(readBack[1]?.status, "Non lu");

  assert.equal(isUnreadNotification(sample({ status: "Non lu" })), true);
  assert.equal(isUnreadNotification(sample({ status: "Lu" })), false);

  // Parcours CTO : création → marquer lu immédiatement → UUID PG utilisé pour le PATCH.
  {
    const postResponse = sample({
      id: "660e8400-e29b-41d4-a716-4466554400aa",
      title: "Flux immédiat",
      status: "Non lu",
    });
    let local = applyCreatedPlatformNotification([], postResponse, clientId);
    const readId = resolveMarkReadTargetId(postResponse, clientId);
    const { id: patchId, patch } = buildPlatformNotificationReadPatch({
      ...postResponse,
      id: readId,
    });
    assert.equal(patchId, postResponse.id);
    assert.deepEqual(patch, { status: "Lu" });
    local = applyReadPlatformNotification(local, { ...postResponse, status: "Lu" });
    assert.equal(local[0]?.id, postResponse.id);
    assert.equal(local[0]?.status, "Lu");
  }

  console.log("platformNotificationSync.test.ts OK");
}

run();
