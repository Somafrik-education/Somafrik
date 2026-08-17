import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import { AuthProvider, useAuth } from "../context/AuthContext";

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

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthProvider — permissions live sans refresh", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockReset();
  });

  it("hydrate GET /auth/effective-permissions juste après login, sans remount", async () => {
    vi.mocked(api.post).mockResolvedValue({
      accessToken: "login-token",
      refreshToken: "refresh-token",
      user: {
        id: "u1",
        identifier: "admin",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        permissions: ["Enseignants:UPDATE"],
      },
    });
    vi.mocked(api.get).mockResolvedValue({
      permissions: ["Enseignants:UPDATE", "Affectations:CREATE", "Matières:READ"],
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login({
        identifier: "admin",
        password: "1234",
        profile: "school",
        schoolCode: "CD-2026-0001",
      });
    });

    await waitFor(() => {
      expect(result.current.permissionsReady).toBe(true);
    });
    expect(api.get).toHaveBeenCalledWith("/auth/effective-permissions");
    expect(result.current.session?.user?.permissions).toContain("Affectations:CREATE");
    expect(result.current.session?.user?.permissions).toContain("Matières:READ");
  });

  it("reste en bootstrap loading tant que GET /auth/effective-permissions n'a pas répondu", async () => {
    const pendingGets: Array<(value: { permissions: string[] }) => void> = [];
    vi.mocked(api.post).mockResolvedValue({
      accessToken: "login-token",
      refreshToken: "refresh-token",
      user: {
        id: "u1",
        identifier: "admin",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        permissions: ["Enseignants:UPDATE"],
      },
    });
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingGets.push(resolve);
        }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    let loginPromise: Promise<unknown> | undefined;
    await act(async () => {
      loginPromise = result.current.login({
        identifier: "admin",
        password: "1234",
        profile: "school",
        schoolCode: "CD-2026-0001",
      });
    });

    await waitFor(() => {
      expect(result.current.permissionsBootstrap).toBe("loading");
    });
    expect(result.current.permissionsReady).toBe(false);

    await act(async () => {
      for (const resolveGet of pendingGets.splice(0)) {
        resolveGet({ permissions: ["Affectations:CREATE"] });
      }
      await loginPromise;
    });
    await waitFor(() => {
      expect(result.current.permissionsReady).toBe(true);
    });
    expect(result.current.session?.user?.permissions).toContain("Affectations:CREATE");
  });

  it("en cas de 500 sur effective-permissions, n'affiche pas un faux deny et conserve la session", async () => {
    vi.mocked(api.post).mockResolvedValue({
      accessToken: "login-token",
      refreshToken: "refresh-token",
      user: {
        id: "u1",
        identifier: "admin",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        permissions: ["Enseignants:UPDATE"],
      },
    });
    vi.mocked(api.get).mockRejectedValue(new ApiError("Permissions indisponibles", 500));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login({
        identifier: "admin",
        password: "1234",
        profile: "school",
        schoolCode: "CD-2026-0001",
      });
    });

    await waitFor(() => {
      expect(result.current.permissionsBootstrap).toBe("error");
    });
    expect(result.current.permissionsReady).toBe(false);
    expect(result.current.session?.accessToken).toBe("login-token");
    expect(result.current.permissionsBootstrapError).toMatch(/Permissions indisponibles|permissions effectives/i);
  });
});
