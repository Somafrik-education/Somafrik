import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushRuntime } from "./WebPushRuntime";

const syncSpy = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("../lib/webPushPermission", () => ({
  syncWebPushSubscription: (...args: unknown[]) => syncSpy(...args),
}));

describe("WebPushRuntime — échec d'abonnement observable", () => {
  beforeEach(() => {
    syncSpy.mockReset();
  });

  it("permission denied : aucun message d'erreur", async () => {
    syncSpy.mockResolvedValue("denied");
    const { container } = render(<WebPushRuntime />);
    await vi.waitFor(() => expect(syncSpy).toHaveBeenCalledTimes(1));
    expect(container).not.toHaveTextContent("n'ont pas pu être activées");
  });

  it("échec technique : message visible + Réessayer relance", async () => {
    syncSpy.mockRejectedValueOnce(new Error("registration failed")).mockResolvedValueOnce("subscribed");
    const user = userEvent.setup();
    render(<WebPushRuntime />);
    expect(await screen.findByText(/n'ont pas pu être activées/)).toBeInTheDocument();
    expect(screen.queryByText(/VAPID|FCM|Expo|endpoint/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    await vi.waitFor(() => expect(syncSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/n'ont pas pu être activées/)).not.toBeInTheDocument();
  });
});
