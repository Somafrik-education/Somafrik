import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  ComingSoonState,
  EmptyState,
  ErrorState,
  ForbiddenState,
  InlineAlert,
  LoadingState,
  ToastProvider,
  useToast,
} from "./index";

describe("InlineAlert", () => {
  it("uses status role for non-danger tones and alert for danger", () => {
    const { rerender } = render(<InlineAlert tone="info">Info</InlineAlert>);
    expect(screen.getByRole("status")).toHaveTextContent("Info");

    rerender(<InlineAlert tone="danger">Erreur</InlineAlert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Erreur");
  });

  it("renders title and action", () => {
    render(
      <InlineAlert title="Attention" action={<button type="button">Voir</button>}>
        Détail
      </InlineAlert>,
    );
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voir" })).toBeInTheDocument();
  });
});

describe("EmptyState vs ComingSoonState", () => {
  it("EmptyState exposes title and optional action", () => {
    render(
      <EmptyState
        title="Aucun établissement actif"
        description="Sélectionnez un établissement."
        action={<button type="button">Choisir</button>}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Aucun établissement actif");
    expect(screen.getByRole("button", { name: "Choisir" })).toBeInTheDocument();
  });

  it("ComingSoonState shows badge and is distinct from empty copy contract", () => {
    render(
      <ComingSoonState
        title="Salles"
        description="La gestion des salles arrive bientôt."
        badge="Bientôt disponible"
      />,
    );
    expect(screen.getByRole("heading", { name: "Salles" })).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
  });
});

describe("LoadingState / ErrorState / ForbiddenState", () => {
  it("LoadingState announces loading", () => {
    render(<LoadingState message="Chargement du profil…" />);
    expect(screen.getByText("Chargement du profil…")).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(1);
  });

  it("ErrorState uses alert role", () => {
    render(<ErrorState message="Échec réseau" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Échec réseau");
  });

  it("ForbiddenState is not an alert and offers action slot", () => {
    render(
      <ForbiddenState action={<a href="/">Retour</a>} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.getByRole("link", { name: "Retour" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

function ToastProbe() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast("Enregistré", "success")}>
      Notify
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows message via provider and hides after timeout", () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Notify" }).click();
    });
    expect(screen.getByText("Enregistré")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(screen.getByText("Enregistré").closest("[aria-live]")).toHaveClass("opacity-0");
  });

  it("throws outside provider", () => {
    expect(() => render(<ToastProbe />)).toThrow(/ToastProvider/);
  });
});
