import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentCardPrintView } from "./StudentCardPrintView";

const qrToDataUrl = vi.hoisted(() => vi.fn(async (value: string, options?: unknown) => {
  void options;
  return `data:image/png;base64,len-${value.length}`;
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: (value: string, options?: unknown) => qrToDataUrl(value, options) },
}));

const identity = {
  displayName: "Kabila Amina",
  classLabel: "6ème A",
  studentCode: "CD-001",
  schoolName: "Lycée Test",
  photoUrl: null,
  publicId: "CARD-A",
};

const school = {
  code: "CD-1",
  hasLogo: true,
  logoSource: "school_upload" as const,
  logoUploadedAt: "2026-10-01T00:00:00.000Z",
};

function renderCard() {
  return render(
    <StudentCardPrintView
      cardToken="CARD-A.TOKEN-1"
      identity={identity}
      school={school}
      onClose={() => undefined}
    />,
  );
}

function expectSecretAbsent() {
  expect(document.body.textContent).not.toContain("TOKEN-1");
  expect(document.body.innerHTML).not.toContain("CARD-A.TOKEN-1");
}

describe("StudentCardPrintView", () => {
  beforeEach(() => {
    qrToDataUrl.mockReset();
    qrToDataUrl.mockImplementation(async (value: string, options?: unknown) => {
      void options;
      return `data:image/png;base64,len-${value.length}`;
    });
  });

  it("encode exactement le cardToken, au format CR80, sans secret en clair", async () => {
    renderCard();
    const sheet = await screen.findByTestId("student-card-sheet");
    expect(sheet).toHaveStyle({ width: "85.60mm", height: "53.98mm" });
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expect(screen.getByText("Kabila Amina")).toBeInTheDocument();
    expect(screen.getByText("ID carte : CARD-A")).toBeInTheDocument();
    expect(qrToDataUrl).toHaveBeenCalledWith("CARD-A.TOKEN-1", expect.any(Object));
    expectSecretAbsent();
    expect(document.body.textContent).not.toContain("parentPhone");
    expect(document.querySelector('img[src*="/logo"]')).toBeTruthy();
  });

  it("laisse Imprimer désactivé tant que le QR est en cours", async () => {
    let resolveQr: (value: string) => void = () => undefined;
    qrToDataUrl.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveQr = resolve;
        }),
    );
    renderCard();
    expect(screen.getByText("Génération du QR…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    expectSecretAbsent();
    resolveQr("data:image/png;base64,len-16");
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expectSecretAbsent();
  });

  it("désactive Imprimer si le QR échoue et réessaie localement", async () => {
    const user = userEvent.setup();
    qrToDataUrl.mockRejectedValue(new Error("qr"));
    renderCard();
    expect(await screen.findByText("Le QR n’a pas pu être généré. N’imprimez pas cette carte.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expectSecretAbsent();
    const callsBeforeRetry = qrToDataUrl.mock.calls.length;
    qrToDataUrl.mockResolvedValue("data:image/png;base64,len-16");
    await user.click(screen.getByRole("button", { name: "Réessayer le QR" }));
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Réessayer le QR" })).toBeNull();
    expect(qrToDataUrl.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    for (const call of qrToDataUrl.mock.calls) {
      expect(call[0]).toBe("CARD-A.TOKEN-1");
    }
    expectSecretAbsent();
  });
});
