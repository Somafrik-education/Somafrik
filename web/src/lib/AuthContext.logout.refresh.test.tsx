import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { AuthProvider, useAuth } from "../context/AuthContext";

const API = "http://localhost:5000/api";

const session = {
  accessToken: "expired-access",
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

function authHeader(init?: RequestInit) {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization ?? "";
}

describe("AuthProvider logout — accès expiré", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("rafraîchit une fois puis appelle la révocation authentifiée", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      const auth = authHeader(init);
      if (href === `${API}/auth/effective-permissions`) {
        return new Response(JSON.stringify({ permissions: ["Affectations:CREATE"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href === `${API}/auth/logout` && auth.includes("expired-access")) {
        return new Response(JSON.stringify({ message: "Session expirée" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href === `${API}/auth/refresh`) {
        return new Response(JSON.stringify({ accessToken: "new-access", refreshToken: "new-refresh" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href === `${API}/auth/logout` && auth.includes("new-access")) {
        return new Response(JSON.stringify({ message: "Déconnexion sécurisée effectuée" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: `unexpected ${href}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(session));
    await waitFor(() => expect(result.current.permissionsReady).toBe(true));

    await act(async () => result.current.logout());

    expect(result.current.session).toBeNull();
    expect(sessionStorage.getItem("somafrik.web.session")).toBeNull();
    const logoutAndRefresh = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((href) => href.endsWith("/auth/logout") || href.endsWith("/auth/refresh"));
    expect(logoutAndRefresh).toEqual([`${API}/auth/logout`, `${API}/auth/refresh`, `${API}/auth/logout`]);
  });
});
