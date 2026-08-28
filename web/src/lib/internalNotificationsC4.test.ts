import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "./communicationSchoolScope";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const STORAGE_KEY = "somafrik.activeSchoolCode";

describe("internal notifications C4 web", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("scope établissement A puis B sur unread-count et liste", () => {
    sessionStorage.setItem(STORAGE_KEY, "SCH-C4-A");
    expect(withCommunicationSchoolScope("/backoffice/internal-notifications")).toContain(
      "effectiveSchoolCode=SCH-C4-A",
    );
    expect(withCommunicationSchoolScope("/backoffice/internal-notifications/unread-count")).toContain(
      "SCH-C4-A",
    );
    expect(withCommunicationSchoolPayload({ title: "x" }).effectiveSchoolCode).toBe("SCH-C4-A");
    sessionStorage.setItem(STORAGE_KEY, "SCH-C4-B");
    expect(withCommunicationSchoolScope("/backoffice/internal-notifications")).toContain(
      "effectiveSchoolCode=SCH-C4-B",
    );
    expect(withCommunicationSchoolScope("/backoffice/internal-notifications")).not.toContain("SCH-C4-A");
  });

  it("fail-closed sans établissement plateforme", () => {
    expect(hasCommunicationSchoolScope("*")).toBe(false);
    expect(withCommunicationSchoolScope("/backoffice/internal-notifications", "*")).toBe(
      "/backoffice/internal-notifications",
    );
  });

  it("API + centre : unread-count serveur, pas de localStorage, ComingSoon paramètres", () => {
    const api = readFileSync(join(ROOT, "internalNotificationsApi.ts"), "utf8");
    const read = readFileSync(join(ROOT, "internalNotificationsRead.ts"), "utf8");
    const center = readFileSync(join(ROOT, "../components/communications/InternalNotificationsCenter.tsx"), "utf8");
    const topbar = readFileSync(join(ROOT, "../components/layout/Topbar.tsx"), "utf8");
    const page = readFileSync(join(ROOT, "../pages/NotificationsPage.tsx"), "utf8");
    const placeholders = readFileSync(join(ROOT, "../pages/parametres/SettingsPlaceholders.tsx"), "utf8");
    const hub = readFileSync(join(ROOT, "../pages/parametres/SettingsHubPage.tsx"), "utf8");

    expect(api).toMatch(/internal-notifications\/unread-count/);
    expect(api).toMatch(/Idempotency-Key/);
    expect(api).toMatch(/markRead/);
    expect(api).toMatch(/archive/);
    expect(read).toMatch(/\.unreadCount\(/);
    expect(read).not.toMatch(/localStorage/);
    expect(center).not.toMatch(/localStorage/);
    expect(center).toMatch(/notifyInternalNotificationsChanged/);
    expect(topbar).toMatch(/useInternalNotificationsUnreadCount/);
    expect(page).toMatch(/InternalNotificationsCenter/);
    expect(placeholders).toMatch(/ComingSoonState/);
    expect(hub).toMatch(/status: "soon"/);
    expect(hub).toMatch(/\/parametres\/notifications/);
  });
});
