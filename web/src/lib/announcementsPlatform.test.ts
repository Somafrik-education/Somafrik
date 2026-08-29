import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("annonces plateforme Superadmin", () => {
  it("page Superadmin : pas d'audiences C3, confirmation système, agrégation", () => {
    const page = readFileSync(join(ROOT, "../pages/AnnouncementsPage.tsx"), "utf8");
    const api = readFileSync(join(ROOT, "platformAnnouncementsApi.ts"), "utf8");
    const read = readFileSync(join(ROOT, "announcementsRead.ts"), "utf8");
    expect(page).toMatch(/isSuperAdminRole/);
    expect(page).toMatch(/Annonce administrative/);
    expect(page).toMatch(/Annonce système Somafrik/);
    expect(page).toMatch(/Administrateurs pays/);
    expect(page).toMatch(/Administrateurs d'établissement/);
    expect(page).toMatch(/Tous les administrateurs/);
    expect(page).toMatch(/Tous les utilisateurs Somafrik/);
    expect(page).toMatch(/tous les utilisateurs\s+actifs de Somafrik/i);
    expect(page).toMatch(/platformAnnouncementsApi\.publish/);
    expect(page).toMatch(/platformAnnouncementsApi\.markRead/);
    expect(page).toMatch(/announcementsApi\.markRead/);
    expect(page).toMatch(/announcementsApi\s*\n\s*\.audienceOptions/);
    expect(page).toMatch(/!isGlobalSuperadmin && schoolScope/);
    expect(page).not.toMatch(/localStorage/);
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
    expect(api).toMatch(/Idempotency-Key/);
    expect(api).not.toMatch(/effectiveSchoolCode/);
    expect(read).toMatch(/platformAnnouncementsApi\.unreadCount/);
    expect(read).not.toMatch(/localStorage/);
    expect(read.replace(/\s+/g, " ")).not.toMatch(/\.catch\(\(\) => \(\{ count: 0 \}\)\)/);
    expect(page.replace(/\s+/g, " ")).not.toMatch(/\.catch\(\(\) => \(\{ items: \[\]/);
    expect(page).toMatch(/schoolScope\s*\n\s*\? announcementsApi\.list\(schoolScope\)/);
    expect(page).toMatch(/Promise\.resolve\(\{ items: \[\] as AnnouncementRecord\[\] \}\)/);
  });
});
