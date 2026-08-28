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

describe("announcements C3 web", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("scope établissement A puis B sur les URLs annonces", () => {
    sessionStorage.setItem(STORAGE_KEY, "SCH-COM-A");
    expect(withCommunicationSchoolScope("/backoffice/announcements")).toContain("effectiveSchoolCode=SCH-COM-A");
    expect(withCommunicationSchoolScope("/backoffice/announcements/unread-count")).toContain("SCH-COM-A");
    expect(withCommunicationSchoolPayload({ title: "x" }).effectiveSchoolCode).toBe("SCH-COM-A");
    sessionStorage.setItem(STORAGE_KEY, "SCH-COM-B");
    expect(withCommunicationSchoolScope("/backoffice/announcements")).toContain("effectiveSchoolCode=SCH-COM-B");
    expect(withCommunicationSchoolScope("/backoffice/announcements")).not.toContain("SCH-COM-A");
  });

  it("fail-closed sans établissement plateforme", () => {
    expect(hasCommunicationSchoolScope("*")).toBe(false);
    expect(withCommunicationSchoolScope("/backoffice/announcements", "*")).toBe("/backoffice/announcements");
  });

  it("API + page : idempotency, mark-read serveur, pas de localStorage", () => {
    const api = readFileSync(join(ROOT, "announcementsApi.ts"), "utf8");
    const read = readFileSync(join(ROOT, "announcementsRead.ts"), "utf8");
    const page = readFileSync(join(ROOT, "../pages/AnnouncementsPage.tsx"), "utf8");
    expect(api).toMatch(/Idempotency-Key/);
    expect(api).toMatch(/unread-count/);
    expect(api).toMatch(/audience-options/);
    expect(api).toMatch(/attachmentIds|uploadAttachment/);
    expect(read).not.toMatch(/localStorage/);
    expect(page).not.toMatch(/localStorage/);
    expect(page).toMatch(/announcementsApi\.markRead/);
    expect(page).toMatch(/formatDisplayDate/);
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
