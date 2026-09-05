import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  request,
  requestBlob,
  setAccessTokenProvider,
  setRefreshTokenProvider,
  setRotatedTokenPersister,
} from "../api/client";

const API = "http://localhost:5000/api";

function authHeader(init?: RequestInit) {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization ?? "";
}

describe("client API — refresh après 401", () => {
  let access = "expired-access";
  let refresh = "refresh-token";

  beforeEach(() => {
    access = "expired-access";
    refresh = "refresh-token";
    setAccessTokenProvider(() => access);
    setRefreshTokenProvider(() => refresh);
    setRotatedTokenPersister((tokens) => {
      access = tokens.accessToken;
      if (tokens.refreshToken) refresh = tokens.refreshToken;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessTokenProvider(() => null);
    setRefreshTokenProvider(() => null);
    setRotatedTokenPersister(null);
  });

  it("POST /auth/logout rafraîchit l'accès expiré puis révoque", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      const auth = authHeader(init);
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
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const data = await api.post("/auth/logout");
    expect(data).toEqual({ message: "Déconnexion sécurisée effectuée" });
    expect(access).toBe("new-access");
    expect(refresh).toBe("new-refresh");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `${API}/auth/logout`,
      `${API}/auth/refresh`,
      `${API}/auth/logout`,
    ]);
  });

  it("requestBlob retente après refresh", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      const auth = authHeader(init);
      if (href.endsWith("/attachments/file-1") && auth.includes("expired-access")) {
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
      if (href.endsWith("/attachments/file-1") && auth.includes("new-access")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = await requestBlob("/backoffice/communications/attachments/file-1");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `${API}/backoffice/communications/attachments/file-1`,
      `${API}/auth/refresh`,
      `${API}/backoffice/communications/attachments/file-1`,
    ]);
  });

  it("ne rafraîchit pas /auth/refresh (évite une boucle)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Session expirée" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("/auth/refresh", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
