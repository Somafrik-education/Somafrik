import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import { api } from "../api/client";
import { resolveUserSchools } from "./clientsApi";

const getMock = vi.mocked(api.get);

describe("resolveUserSchools", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("résout l'alias historique via /schools/:code et expose le login_code canonique", async () => {
    getMock.mockResolvedValue({
      code: "CD-IN-26-001",
      publicId: "CD-IN-26-001",
      schoolCode: "CD-2026-0001",
      name: "INSTITUT NURU",
    });

    const schools = await resolveUserSchools([
      { schoolCode: "CD-2026-0001" },
      { schoolCode: "CD-2026-0001" },
    ]);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/schools/CD-2026-0001");
    expect(schools).toEqual([
      expect.objectContaining({
        publicId: "CD-IN-26-001",
        name: "INSTITUT NURU",
      }),
    ]);
  });

  it("ignore les comptes plateforme sans établissement", async () => {
    const schools = await resolveUserSchools([{ schoolCode: "*" }, { schoolCode: "" }]);

    expect(getMock).not.toHaveBeenCalled();
    expect(schools).toEqual([]);
  });
});
