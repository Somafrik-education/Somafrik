/**
 * Lot C — unread Web : une erreur transport ne falsifie pas le compteur.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES_UNREAD_CHANGED_EVENT, useMessagesUnreadCount } from "./messagesRead";

const unreadCount = vi.hoisted(() => vi.fn());

vi.mock("./messagesApi", () => ({
  messagesApi: {
    unreadCount,
  },
}));

describe("useMessagesUnreadCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conserve la dernière valeur connue si le refresh échoue", async () => {
    unreadCount.mockResolvedValueOnce({ count: 4 }).mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useMessagesUnreadCount(true, "SCH-001"));
    await waitFor(() => expect(result.current).toBe(4));

    act(() => {
      window.dispatchEvent(new Event(MESSAGES_UNREAD_CHANGED_EVENT));
    });
    await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(4);
  });

  it("P1-03 changement d'établissement remet le compteur à 0 avant le prochain GET", async () => {
    unreadCount.mockResolvedValueOnce({ count: 4 }).mockResolvedValueOnce({ count: 1 });
    const { result, rerender } = renderHook(
      ({ school }) => useMessagesUnreadCount(true, school),
      { initialProps: { school: "SCH-A" } },
    );
    await waitFor(() => expect(result.current).toBe(4));
    rerender({ school: "SCH-B" });
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(1));
  });
});
