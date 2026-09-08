import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const { getSettings, patchSettings, school } = vi.hoisted(() => {
  const school = { code: "SCH-001", name: "Lycée Test" };
  return {
    school,
    getSettings: vi.fn(),
    patchSettings: vi.fn(),
  };
});

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchool: school }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School" } }),
}));

vi.mock("../../lib/permissions", () => ({
  canManageEstablishmentSettings: () => true,
}));

vi.mock("../../lib/schoolNotificationSettingsApi", () => ({
  getSchoolNotificationSettings: (...args: unknown[]) => getSettings(...args),
  patchSchoolNotificationSettings: (...args: unknown[]) => patchSettings(...args),
}));

import { SettingsNotificationsPage } from "./SettingsPlaceholders";

const FIXTURE = {
  schoolCode: "SCH-001",
  events: {
    STUDENT_ABSENT: {
      allowedRecipients: ["PARENT"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    STUDENT_LATE: {
      allowedRecipients: ["PARENT"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    GRADE_PUBLISHED: {
      allowedRecipients: ["PARENT", "STUDENT"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
      STUDENT: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    REPORT_CARD_PUBLISHED: {
      allowedRecipients: ["PARENT", "STUDENT"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
      STUDENT: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    PAYMENT_RECEIVED: {
      allowedRecipients: ["PARENT"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    PAYMENT_DUE: {
      allowedRecipients: ["PARENT", "SCHOOL_ADMIN"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
      SCHOOL_ADMIN: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    ANNOUNCEMENT_PUBLISHED: {
      allowedRecipients: ["PARENT", "STUDENT", "TEACHER", "SCHOOL_ADMIN"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
      STUDENT: { IN_APP: true, PUSH: true, EMAIL: true },
      TEACHER: { IN_APP: true, PUSH: true, EMAIL: true },
      SCHOOL_ADMIN: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    TIMETABLE_CHANGED: {
      allowedRecipients: ["TEACHER", "SCHOOL_ADMIN"],
      TEACHER: { IN_APP: true, PUSH: true, EMAIL: true },
      SCHOOL_ADMIN: { IN_APP: true, PUSH: true, EMAIL: true },
    },
    TEACHER_REPLACEMENT: {
      allowedRecipients: ["PARENT", "TEACHER", "SCHOOL_ADMIN"],
      PARENT: { IN_APP: true, PUSH: true, EMAIL: true },
      TEACHER: { IN_APP: true, PUSH: true, EMAIL: true },
      SCHOOL_ADMIN: { IN_APP: true, PUSH: true, EMAIL: true },
    },
  },
};

describe("Lot I — Paramètres → Notifications", () => {
  beforeEach(() => {
    getSettings.mockReset();
    patchSettings.mockReset();
    getSettings.mockResolvedValue(FIXTURE);
    patchSettings.mockImplementation(async (_code: string, patch: { events: typeof FIXTURE.events }) => {
      const next = structuredClone(FIXTURE);
      const eventKey = Object.keys(patch.events)[0] as keyof typeof FIXTURE.events;
      const recipient = Object.keys(patch.events[eventKey])[0];
      const channels = patch.events[eventKey][recipient as "PARENT"];
      Object.assign(next.events[eventKey][recipient as "PARENT"], channels);
      return next;
    });
  });

  it("I-T14 — affiche un état de chargement avant réception des règles", async () => {
    let resolveGet!: (value: typeof FIXTURE) => void;
    getSettings.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));

    render(<SettingsNotificationsPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Chargement/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    resolveGet(FIXTURE);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("I-T15 — un interrupteur ne mute que la règle attendue", async () => {
    const user = userEvent.setup();
    render(<SettingsNotificationsPage />);

    expect(await screen.findByRole("columnheader", { name: "Événement" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Destinataires" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Application" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Push" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "E-mail" })).toBeInTheDocument();

    const pushSwitch = await screen.findByRole("switch", {
      name: /Absence d'un élève.*Parents.*Push/i,
    });
    expect(pushSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(pushSwitch);

    await waitFor(() => {
      expect(patchSettings).toHaveBeenCalledTimes(1);
    });
    expect(patchSettings.mock.calls[0][0]).toBe("SCH-001");
    expect(patchSettings.mock.calls[0][1]).toEqual({
      events: { STUDENT_ABSENT: { PARENT: { PUSH: false } } },
    });
    await waitFor(() => {
      expect(pushSwitch).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.queryByText(/SMTP|Expo|FCM|Brevo|WhatsApp/i)).not.toBeInTheDocument();
  });

  it("I-T16 — refus API : message visible, rollback, pas de fausse confirmation", async () => {
    const user = userEvent.setup();
    patchSettings.mockRejectedValue(new Error("Enregistrement refusé par le serveur."));

    render(<SettingsNotificationsPage />);
    const emailSwitch = await screen.findByRole("switch", {
      name: /Absence d'un élève.*Parents.*E-mail/i,
    });
    expect(emailSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(emailSwitch);

    expect(await screen.findByRole("alert")).toHaveTextContent(/refus|impossible|enregistr/i);
    expect(emailSwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/enregistré|sauvegardé/i)).not.toBeInTheDocument();
  });

  it("aucun vocabulaire technique provider dans l'écran", async () => {
    render(<SettingsNotificationsPage />);
    await screen.findByRole("table");
    const page = document.body.textContent || "";
    expect(page).not.toMatch(/SMTP|Expo|FCM|Brevo|WhatsApp|SMS/i);
    expect(page).toMatch(/Absence d'un élève/);
  });
});

describe("Lot I — hub Paramètres", () => {
  it("la carte Notifications n'est plus un ComingSoon", () => {
    const hub = readFileSync(join(ROOT, "SettingsHubPage.tsx"), "utf8");
    const placeholders = readFileSync(join(ROOT, "SettingsPlaceholders.tsx"), "utf8");
    const notificationsCard = hub.slice(
      hub.indexOf('to: "/parametres/notifications"'),
      hub.indexOf('to: "/parametres/apparence"'),
    );
    expect(notificationsCard).toMatch(/status:\s*"available"/);
    expect(placeholders).not.toMatch(/Canaux de communication \(push, e-mail, SMS, WhatsApp\)/);
  });
});
