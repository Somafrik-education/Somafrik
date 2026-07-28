import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { api } from "../api/client";
import { AuthProvider, useAuth } from "../context/AuthContext";

vi.mock("../api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/client")>();
  return {
    ...original,
    api: {
      ...original.api,
      post: vi.fn(),
    },
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

describe("AuthProvider logout", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(api.post).mockReset();
  });

  it("révoque la session serveur avant d'effacer la session locale", async () => {
    vi.mocked(api.post).mockResolvedValue({ message: "Déconnexion sécurisée effectuée" });
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.setSession(session));
    await act(async () => result.current.logout());

    expect(api.post).toHaveBeenCalledWith("/auth/logout");
    expect(result.current.session).toBeNull();
    expect(sessionStorage.getItem("somafrik.web.session")).toBeNull();
  });

  it("efface la session locale même si la révocation serveur échoue", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("API indisponible"));
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.setSession(session));
    await act(async () => result.current.logout());

    expect(result.current.session).toBeNull();
    expect(sessionStorage.getItem("somafrik.web.session")).toBeNull();
  });
});
