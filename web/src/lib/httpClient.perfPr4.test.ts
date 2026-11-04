import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PERF-PR4 — client HTTP Web : délais, annulation, typage des erreurs, jetons.
 * Le fetch simulé respecte le signal d'annulation comme un navigateur.
 */

type Reply = { status: number; body?: unknown; delayMs?: number };

function jwt(expiresInSeconds: number) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  return `header.${payload}.signature`;
}

function fakeFetch(route: (url: string, init: RequestInit) => Reply | Promise<Reply>) {
  return vi.fn((url: string, init: RequestInit = {}) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      void Promise.resolve(route(url, init)).then((reply) => {
        const deliver = () => {
          if (signal?.aborted) return;
          signal?.removeEventListener("abort", abort);
          const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
          resolve({
            ok: reply.status >= 200 && reply.status < 300,
            status: reply.status,
            text: async () => text,
            json: async () => reply.body,
            blob: async () => new Blob([text]),
          } as unknown as Response);
        };
        if (reply.delayMs) setTimeout(deliver, reply.delayMs);
        else deliver();
      });
    });
  });
}

async function loadClient(access: () => string | null = () => "token-a", refresh: () => string | null = () => null) {
  const client = await import("../api/client");
  client.setAccessTokenProvider(access);
  client.setRefreshTokenProvider(refresh);
  client.setRotatedTokenPersister(() => {});
  return client;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client HTTP — réponses et erreurs typées", () => {
  it("lecture réussie : corps JSON et jeton porteur", async () => {
    const fetcher = fakeFetch(() => ({ status: 200, body: [{ id: 1 }] }));
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient();
    await expect(client.api.get("/students")).resolves.toEqual([{ id: 1 }]);
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-a");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 403, 500])("HTTP %i → ApiError avec statut, code et message serveur", async (status) => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ status, body: { message: `refus ${status}`, code: `E${status}` } })));
    const client = await loadClient();
    const error = await client.api.get("/students").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(client.ApiError);
    expect(error).toMatchObject({ kind: "http", status, code: `E${status}`, message: `refus ${status}` });
  });

  it("401 sans jeton de renouvellement → session expirée (ApiError 401), jamais une donnée", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 401, body: { message: "JWT requis" } })));
    const client = await loadClient();
    const error = await client.api.get("/students").catch((cause: unknown) => cause);
    expect(client.isSessionExpiredError(error)).toBe(true);
  });

  it("erreur réseau → ApiNetworkError (pas une ApiError, pas un délai)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const client = await loadClient();
    const error = await client.api.get("/students").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(client.ApiNetworkError);
    expect(error).not.toBeInstanceOf(client.ApiError);
  });
});

describe("client HTTP — délai", () => {
  it("lecture : délai par défaut de 20 s, puis ApiTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 200, body: [], delayMs: 60_000 })));
    const client = await loadClient();
    expect(client.httpTimeouts.readMs).toBe(20_000);
    const pending = client.api.get("/students").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(client.isApiTimeoutError(error)).toBe(true);
    expect(error).toMatchObject({ kind: "timeout", timeoutMs: 20_000, outcomeUnknown: false });
  });

  it("délai explicite par appel, et aucun minuteur orphelin après succès", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 200, body: { ok: true }, delayMs: 50 })));
    const client = await loadClient();
    const pending = client.api.get("/students", { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("écriture : aucun délai par défaut", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 201, body: { id: "p-1" }, delayMs: 90_000 })));
    const client = await loadClient();
    const pending = client.api.post("/payments", { amount: 10 });
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(pending).resolves.toEqual({ id: "p-1" });
  });

  it("mutation terminée côté serveur après le délai client : issue inconnue, aucun rejeu", async () => {
    vi.useFakeTimers();
    let serverWrites = 0;
    const fetcher = fakeFetch(() => {
      serverWrites += 1; // le serveur exécute l'écriture…
      return { status: 201, body: { id: "p-1" }, delayMs: 30_000 }; // …mais répond trop tard
    });
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient();
    const pending = client.api.post("/payments", { amount: 10 }, { timeoutMs: 10_000 }).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;
    expect(error).toMatchObject({ kind: "timeout", method: "POST", outcomeUnknown: true });
    expect((error as Error).message).toMatch(/peut-être été enregistrée/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(serverWrites).toBe(1);
  });

  it.each([
    ["500", () => ({ status: 500, body: { message: "panne" } })],
    ["réseau", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("écriture non idempotente : aucun rejeu automatique après %s", async (_label, reply) => {
    const fetcher = vi.fn(async () => {
      const value = await (reply as () => Reply | Promise<Reply>)();
      return { ok: false, status: value.status, text: async () => JSON.stringify(value.body) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient();
    await expect(client.api.post("/payments", { amount: 10 })).rejects.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("client HTTP — annulation", () => {
  it("annulation volontaire → ApiAbortError, distincte d'un délai ou d'une panne", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 200, body: [], delayMs: 5_000 })));
    const client = await loadClient();
    const controller = new AbortController();
    const pending = client.api.get("/students", { signal: controller.signal }).catch((cause: unknown) => cause);
    controller.abort();
    const error = await pending;
    expect(client.isApiAbortError(error)).toBe(true);
    expect(client.isApiTimeoutError(error)).toBe(false);
  });

  it("signal déjà annulé : aucune requête envoyée", async () => {
    const fetcher = fakeFetch(() => ({ status: 200, body: [] }));
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient();
    const controller = new AbortController();
    controller.abort();
    await expect(client.api.get("/students", { signal: controller.signal })).rejects.toBeInstanceOf(client.ApiAbortError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("l'écouteur d'annulation est retiré après la réponse", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 200, body: [] })));
    const client = await loadClient();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await client.api.get("/students", { signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("client HTTP — renouvellement des jetons", () => {
  it("401 → un renouvellement puis un rejeu avec le nouveau jeton", async () => {
    let access = "old";
    const fetcher = fakeFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return { status: 200, body: { accessToken: "new", refreshToken: "r2" } };
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new" ? { status: 200, body: ["ok"] } : { status: 401, body: { message: "expiré" } };
    });
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../api/client");
    client.setAccessTokenProvider(() => access);
    client.setRefreshTokenProvider(() => "r1");
    client.setRotatedTokenPersister((tokens) => (access = tokens.accessToken));
    await expect(client.api.get("/students")).resolves.toEqual(["ok"]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("échec du renouvellement → 401 remonté, aucune boucle", async () => {
    const fetcher = fakeFetch((url) =>
      url.endsWith("/auth/refresh") ? { status: 401, body: {} } : { status: 401, body: { message: "expiré" } },
    );
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient(() => "old", () => "r1");
    const error = await client.api.get("/students").catch((cause: unknown) => cause);
    expect(client.isSessionExpiredError(error)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("renouvellement trop lent → délai dépassé, pas une fausse session expirée", async () => {
    vi.useFakeTimers();
    const fetcher = fakeFetch((url) =>
      url.endsWith("/auth/refresh") ? { status: 200, body: { accessToken: jwt(900) }, delayMs: 60_000 } : { status: 200, body: [] },
    );
    vi.stubGlobal("fetch", fetcher);
    const client = await loadClient(() => jwt(5), () => "r1");
    const pending = client.api.get("/students").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(client.httpTimeouts.refreshMs);
    const error = await pending;
    expect(client.isApiTimeoutError(error)).toBe(true);
    expect(client.isSessionExpiredError(error)).toBe(false);
  });

  it("rejeu après 401 d'une écriture : sûr (refus serveur), un seul rejeu", async () => {
    let access = "old";
    let writes = 0;
    const fetcher = fakeFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return { status: 200, body: { accessToken: "new" } };
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth !== "Bearer new") return { status: 401, body: { message: "expiré" } };
      writes += 1;
      return { status: 201, body: { id: "p-1" } };
    });
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../api/client");
    client.setAccessTokenProvider(() => access);
    client.setRefreshTokenProvider(() => "r1");
    client.setRotatedTokenPersister((tokens) => (access = tokens.accessToken));
    await expect(client.api.post("/payments", { amount: 1 })).resolves.toEqual({ id: "p-1" });
    expect(writes).toBe(1);
  });
});
