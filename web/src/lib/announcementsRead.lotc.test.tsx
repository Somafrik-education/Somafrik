/**
 * Lot C — unread Web Annonces : une erreur transport ne falsifie pas le compteur.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENTS_UNREAD_CHANGED_EVENT, useAnnouncementsUnreadCount } from "./announcementsRead";

const schoolUnread = vi.hoisted(() => vi.fn());
const platformUnread = vi.hoisted(() => vi.fn());

vi.mock("./announcementsApi", () => ({
  announcementsApi: {
    unreadCount: schoolUnread,
  },
}));

vi.mock("./platformAnnouncementsApi", () => ({
  platformAnnouncementsApi: {
    unreadCount: platformUnread,
  },
}));

describe("useAnnouncementsUnreadCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conserve la dernière valeur connue si le refresh échoue", async () => {
    schoolUnread.mockResolvedValueOnce({ count: 2 }).mockRejectedValueOnce(new Error("network"));
    platformUnread.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 3 });
    const { result } = renderHook(() => useAnnouncementsUnreadCount(true, "SCH-001"));
    await waitFor(() => expect(result.current).toBe(5));

    act(() => {
      window.dispatchEvent(new Event(ANNOUNCEMENTS_UNREAD_CHANGED_EVENT));
    });
    await waitFor(() => expect(schoolUnread).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(5);
  });
});
