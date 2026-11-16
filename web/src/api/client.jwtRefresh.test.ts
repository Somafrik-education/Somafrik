import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jwt(expiresInSeconds: number) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  return `header.${payload}.signature`;
}

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("JWT refresh during dashboard polling", () => {
  it("refreshes before expiry and sends the rotated bearer token", async () => {
    let access = jwt(10);
    let refresh = "refresh-1";
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return ok({ accessToken: jwt(900), refreshToken: "refresh-2" });
      expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${access}`);
      return ok({ items: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    const client = await import("./client");
    client.setAccessTokenProvider(() => access);
    client.setRefreshTokenProvider(() => refresh);
    client.setRotatedTokenPersister((tokens) => { access = tokens.accessToken; refresh = tokens.refreshToken ?? refresh; });
    await client.request("/dashboard/school-activities?limit=10");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toBe("refresh-2");
  });

  it("shares one refresh between simultaneous API calls", async () => {
    let access = jwt(5);
    const fetcher = vi.fn(async (url: string) => url.endsWith("/auth/refresh")
      ? ok({ accessToken: jwt(900), refreshToken: "refresh-2" }) : ok({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("./client");
    client.setAccessTokenProvider(() => access);
    client.setRefreshTokenProvider(() => "refresh-1");
    client.setRotatedTokenPersister((tokens) => { access = tokens.accessToken; });
    await Promise.all([client.request("/dashboard/school-activities"), client.request("/dashboard/students")]);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("does not loop when refresh is rejected", async () => {
    const access = jwt(-5);
    const fetcher = vi.fn(async (url: string) => url.endsWith("/auth/refresh")
      ? { ok: false, status: 401 } : { ok: false, status: 401, text: async () => JSON.stringify({ message: "Authentification JWT requise" }) });
    vi.stubGlobal("fetch", fetcher);
    const client = await import("./client");
    client.setAccessTokenProvider(() => access);
    client.setRefreshTokenProvider(() => "expired-refresh");
    client.setRotatedTokenPersister(() => {});
    await expect(client.request("/dashboard/school-activities")).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
