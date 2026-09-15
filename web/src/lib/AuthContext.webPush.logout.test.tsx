import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { api } from "../api/client";
import { AuthProvider, useAuth } from "../context/AuthContext";

const revokeSpy = vi.fn();

vi.mock("../api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/client")>();
  return {
    ...original,
    api: {
      ...original.api,
      post: vi.fn(),
      get: vi.fn(),
    },
  };
});

vi.mock("./webPushPermission", async (importOriginal) => {
  const original = await importOriginal<typeof import("./webPushPermission")>();
  return {
    ...original,
    revokeWebPushOnSessionEnd: (...args: unknown[]) => revokeSpy(...args),
  };
});

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  permissions: [],
  schools: [],
  users: [],
  scope: { label: "Test", hint: "Test" },
  user: {
    id: "user-1",
    identifier: "admin",
    role: "Administrateur",
    schoolCode: "CD-TEST-0001",
  },
} as Session;

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthProvider logout — révocation Web Push avant perte du jeton", () => {
  beforeEach(() => {
    sessionStorage.clear();
    revokeSpy.mockReset();
    revokeSpy.mockResolvedValue("revoked");
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ permissions: [] });
    vi.mocked(api.post).mockResolvedValue({ message: "Déconnexion sécurisée effectuée" });
  });

  it("révoque l'abonnement Web Push avant POST /auth/logout et avant setSession(null)", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(session));
    await act(async () => result.current.logout());

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
    expect(revokeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.post).mock.invocationCallOrder[0],
    );
    expect(result.current.session).toBeNull();
  });

  it("déconnecte même si la révocation Web Push ne se résout jamais", async () => {
    revokeSpy.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(session));
    await act(async () => result.current.logout());
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
    expect(result.current.session).toBeNull();
  }, 4000);

  it("déconnecte même si la révocation Web Push échoue, sans exposer de secret", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revokeSpy.mockRejectedValue(new Error("endpoint https://secret.example/push"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(session));
    await act(async () => result.current.logout());
    expect(result.current.session).toBeNull();
    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join(" ");
    expect(logged).toContain("web_push_logout_revoke_failure");
    expect(logged).not.toMatch(/VAPID_PRIVATE_KEY|p256dh/);
    errorSpy.mockRestore();
  });
});
