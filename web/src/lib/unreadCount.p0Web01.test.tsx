import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P0-WEB-01 — badges « non lus » : un retour d'onglet émet `focus` ET `visibilitychange`.
 * Chaque compteur n'envoie qu'un appel tant que le précédent n'est pas revenu.
 */

const internal = vi.hoisted(() => vi.fn());
const messages = vi.hoisted(() => vi.fn());
const schoolAnnouncements = vi.hoisted(() => vi.fn());
const platformAnnouncements = vi.hoisted(() => vi.fn());

vi.mock("./internalNotificationsApi", () => ({ internalNotificationsApi: { unreadCount: internal } }));
vi.mock("./messagesApi", () => ({ messagesApi: { unreadCount: messages } }));
vi.mock("./announcementsApi", () => ({ announcementsApi: { unreadCount: schoolAnnouncements } }));
vi.mock("./platformAnnouncementsApi", () => ({ platformAnnouncementsApi: { unreadCount: platformAnnouncements } }));

import { useAnnouncementsUnreadCount } from "./announcementsRead";
import { useInternalNotificationsUnreadCount } from "./internalNotificationsRead";
import { useMessagesUnreadCount } from "./messagesRead";

function deferred() {
  let resolve!: (value: { count: number }) => void;
  const promise = new Promise<{ count: number }>((r) => (resolve = r));
  return { promise, resolve };
}

const admin = { role: "Admin School" };

function tabReturn() {
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("P0-WEB-01 — unread-count sans doublon", () => {
  beforeEach(() => {
    for (const fn of [internal, messages, schoolAnnouncements, platformAnnouncements]) {
      fn.mockReset();
      fn.mockResolvedValue({ count: 2 });
    }
  });

  it.each([
    ["notifications internes", () => useInternalNotificationsUnreadCount(true, "CD-2026-0001"), internal],
    ["messages", () => useMessagesUnreadCount(true, "CD-2026-0001", admin), messages],
    ["annonces (plateforme)", () => useAnnouncementsUnreadCount(true, "CD-2026-0001", admin), platformAnnouncements],
  ])("%s : retour d'onglet pendant un appel lent → aucun appel supplémentaire", async (_label, hook, api) => {
    const { result } = renderHook(hook);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBeGreaterThan(0));

    const slow = deferred();
    api.mockReturnValueOnce(slow.promise);
    act(() => tabReturn()); // focus + visibilitychange
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    act(() => tabReturn()); // nouveau retour pendant l'appel lent
    expect(api).toHaveBeenCalledTimes(2);

    await act(async () => {
      slow.resolve({ count: 5 });
      await slow.promise;
    });
    act(() => tabReturn()); // appel terminé : un nouvel événement relance bien
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
  });
});
