import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, setAccessTokenProvider } from "../api/client";
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

describe("AuthProvider — token prêt avant fetch métier", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setAccessTokenProvider(() => null);
  });

  it("F — le provider expose le token dès le premier rendu d'une session stockée", () => {
    sessionStorage.setItem(
      "somafrik.web.session",
      JSON.stringify({
        accessToken: "stored-token",
        user: {
          id: "u1",
          role: "Admin School",
          schoolCode: "CD-2026-0001",
          schoolId: "school-a",
          schoolPublicCode: "CD-IN-26-001",
        },
      }),
    );

    renderHook(() => useAuth(), { wrapper });
    expect(getAccessToken()).toBe("stored-token");
  });

  it("F — setSession branche le token de façon synchrone", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(getAccessToken()).toBeNull();

    await act(async () => {
      result.current.setSession({
        accessToken: "login-token",
        scope: { label: "école", hint: "" },
        user: {
          id: "u1",
          role: "Admin School",
          schoolCode: "CD-2026-0001",
          schoolId: "school-a",
          schoolPublicCode: "CD-IN-26-001",
        },
      });
    });

    expect(getAccessToken()).toBe("login-token");
  });
});
