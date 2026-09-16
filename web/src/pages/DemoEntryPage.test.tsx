import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const navigateToDemoMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/demoNavigation", () => ({ navigateToDemo: navigateToDemoMock }));
vi.mock("../lib/featureFlags", () => ({
  publicDemoEnabled: true,
  showDemoAccounts: false,
  marketplaceEnabled: false,
}));

import { DemoEntryPage } from "./DemoEntryPage";

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoEntryPage />
    </MemoryRouter>,
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/profil/i), "direction");
  await user.selectOptions(screen.getByLabelText(/rôle dans la découverte/i), "decider");
  await user.selectOptions(screen.getByLabelText(/pays/i), "CD");
}

describe("DemoEntryPage — qualification publique", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigateToDemoMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_DEMO_ENTRY_API_URL", "https://api-demo.example.test");
    vi.stubEnv("VITE_DEMO_WEB_ORIGIN", "https://demo.somafrik.app");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ne demande ni e-mail ni téléphone avant l'entrée en démo", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: /découvrir somafrik/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/profil/i)).toBeRequired();
    expect(screen.getByLabelText(/rôle dans la découverte/i)).toBeRequired();
    expect(screen.getByLabelText(/pays/i)).toBeRequired();
    expect(screen.queryByLabelText(/e-mail/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/téléphone|whatsapp/i)).not.toBeInTheDocument();
  });

  it("crée une session via l'API Démo dédiée puis redirige vers l'URL fournie", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: "https://demo.somafrik.app/entry?code=opaque-code" }),
    });

    renderPage();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /entrer dans la démo/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-demo.example.test/api/public/demo-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(navigateToDemoMock).toHaveBeenCalledWith(
      "https://demo.somafrik.app/entry?code=opaque-code",
    );
  });

  it("refuse de retomber sur l'API normale si l'API Démo dédiée n'est pas configurée", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_DEMO_ENTRY_API_URL", "");

    renderPage();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /entrer dans la démo/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/démonstration n’est pas encore disponible/i);
  });

  it("refuse une redirection qui ne pointe pas vers un hôte de démo Somafrik", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: "https://evil.example/steal" }),
    });

    renderPage();
    await user.selectOptions(screen.getByLabelText(/profil/i), "enseignant");
    await user.selectOptions(screen.getByLabelText(/rôle dans la découverte/i), "utilisateur");
    await user.selectOptions(screen.getByLabelText(/pays/i), "CD");
    await user.click(screen.getByRole("button", { name: /entrer dans la démo/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/redirection de démo invalide/i);
    expect(navigateToDemoMock).not.toHaveBeenCalled();
  });
});
