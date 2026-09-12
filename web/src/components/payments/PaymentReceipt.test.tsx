import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "user-admin-nuru",
        publicId: "USR-2026-00005",
        permanentId: "USR-2026-00005",
        identifier: "admin.nuru",
        firstName: "Administrateur",
        lastName: "Nuru",
      },
    },
  }),
}));

import { PaymentReceipt } from "./PaymentReceipt";

describe("PaymentReceipt multi-libellés", () => {
  it("affiche toutes les lignes et le total général", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0004",
          studentName: "Esther Okito",
          className: "6ème A",
          items: [
            { feeLabel: "Minerval", amount: 500 },
            { feeLabel: "Frais d'examen", amount: 1 },
            { feeLabel: "Frais de cantine", amount: 40 },
          ],
          method: "Espèces",
          date: "2026-08-19",
          status: "Payé",
          currency: "CDF",
        }}
      />,
    );
    expect(screen.getByText("Minerval")).toBeInTheDocument();
    expect(screen.getByText("Frais d'examen")).toBeInTheDocument();
    expect(screen.getByText("Frais de cantine")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("CD-2026-0001-2026-PAY-0004")).toBeInTheDocument();
  });

  it("affiche le nom du saisissant plutôt que son code utilisateur quand le créateur est l'utilisateur connecté", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0007",
          studentName: "Maeva O'gulgune",
          className: "2ème A",
          items: [{ feeLabel: "Scolarité", amount: 150 }],
          amount: 150,
          method: "Espèces",
          date: "2026-08-24",
          status: "Non imputé",
          currency: "CDF",
          createdBy: "USR-2026-00005",
        }}
      />,
    );

    expect(screen.getByText("Saisi par")).toBeInTheDocument();
    expect(screen.getByText("Administrateur Nuru")).toBeInTheDocument();
    expect(screen.queryByText("USR-2026-00005")).not.toBeInTheDocument();
  });

  it("ne réattribue jamais un paiement historique créé par un autre utilisateur", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0008",
          studentName: "Maeva O'gulgune",
          className: "2ème A",
          items: [{ feeLabel: "Scolarité", amount: 150 }],
          amount: 150,
          method: "Espèces",
          date: "2026-08-24",
          status: "Payé",
          currency: "CDF",
          createdBy: "USR-2026-00999",
        }}
      />,
    );

    expect(screen.getByText("USR-2026-00999")).toBeInTheDocument();
    expect(screen.queryByText("Administrateur Nuru")).not.toBeInTheDocument();
  });

  it("préfère le nom canonique persisté quand il est fourni par l'API", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0009",
          studentName: "Maeva O'gulgune",
          className: "2ème A",
          items: [{ feeLabel: "Scolarité", amount: 150 }],
          amount: 150,
          method: "Espèces",
          date: "2026-08-24",
          status: "Payé",
          currency: "CDF",
          createdBy: "USR-2026-00999",
          createdByName: "Comptable Amina",
        }}
      />,
    );

    expect(screen.getByText("Comptable Amina")).toBeInTheDocument();
    expect(screen.queryByText("USR-2026-00999")).not.toBeInTheDocument();
  });

  it("n'affiche pas « Partiellement payé » pour un trop-perçu Oscar", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-IN-26-001-2026-PAY-0006",
          studentName: "Oscar Mukwege",
          className: "6ème A",
          items: [{ feeLabel: "Frais scolaire — Septembre", amount: 2 }],
          amount: 2,
          allocatedAmount: 1,
          unallocatedAmount: 1,
          method: "Espèces",
          date: "2026-09-07",
          status: "Trop-perçu",
          currency: "CDF",
        }}
      />,
    );
    expect(screen.getByText("Trop-perçu")).toBeInTheDocument();
    expect(screen.queryByText("Partiellement payé")).not.toBeInTheDocument();
  });

  it("traduit un statut historique Partiel en imputation, pas en créance", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-IN-26-001-2026-PAY-0006",
          studentName: "Oscar Mukwege",
          className: "6ème A",
          items: [{ feeLabel: "Frais scolaire — Septembre", amount: 2 }],
          amount: 2,
          method: "Espèces",
          date: "2026-09-07",
          status: "Partiel",
          currency: "CDF",
        }}
      />,
    );
    expect(screen.getByText("Partiellement imputé")).toBeInTheDocument();
    expect(screen.queryByText("Partiellement payé")).not.toBeInTheDocument();
  });

  it("n'affiche pas de logo SCHOOL sans logoSource=school_upload", () => {
    const { container } = render(
      <PaymentReceipt
        school={{
          code: "CD-IN-26-001",
          name: "INSTITUT NURUYETU",
          hasLogo: true,
          logoUrl: "/api/schools/CD-IN-26-001/logo",
        }}
        payment={{
          reference: "CD-IN-26-001-2026-PAY-0010",
          studentName: "Esther Okito",
          className: "6ème A",
          items: [{ feeLabel: "Minerval", amount: 500 }],
          method: "Espèces",
          date: "2026-09-12",
          status: "Payé",
          currency: "CDF",
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("n'affiche pas de logo SCHOOL si hasLogo est absent malgré la provenance", () => {
    const { container } = render(
      <PaymentReceipt
        school={{
          code: "CD-IN-26-001",
          name: "INSTITUT NURUYETU",
          logoSource: "school_upload",
          logoUploadedAt: "2026-09-12T20:00:00.000Z",
        }}
        payment={{
          reference: "CD-IN-26-001-2026-PAY-0012",
          studentName: "Esther Okito",
          className: "6ème A",
          items: [{ feeLabel: "Minerval", amount: 500 }],
          method: "Espèces",
          date: "2026-09-12",
          status: "Payé",
          currency: "CDF",
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("affiche le logo SCHOOL seulement si provenance complète et hasLogo=true", () => {
    const { container } = render(
      <PaymentReceipt
        school={{
          code: "CD-IN-26-001",
          name: "INSTITUT NURUYETU",
          hasLogo: true,
          logoSource: "school_upload",
          logoUploadedAt: "2026-09-12T20:00:00.000Z",
        }}
        payment={{
          reference: "CD-IN-26-001-2026-PAY-0011",
          studentName: "Esther Okito",
          className: "6ème A",
          items: [{ feeLabel: "Minerval", amount: 500 }],
          method: "Espèces",
          date: "2026-09-12",
          status: "Payé",
          currency: "CDF",
        }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(
      /\/api\/schools\/CD-IN-26-001\/logo$/,
    );
  });
});
