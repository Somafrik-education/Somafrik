import { describe, it, expect } from "vitest";

import { scopedAnnouncements, getEstablishmentMetrics } from "../src/lib/establishment";
import {
  isPlatformCommunicationUser,
  isEstablishmentCommunicationUser,
} from "../src/lib/establishmentCommunication";
import { countUnreadAnnouncements } from "../src/lib/announcementsRead";
import type { BackOfficeState, SessionUser, UserAccount } from "../src/types";
import type { PermissionContext } from "../src/lib/permissions";

const state = {
  schools: [
    { code: "SCH1", name: "École 1", countryCode: "CD" },
    { code: "SCH2", name: "École 2", countryCode: "CD" },
  ],
  announcements: [
    { id: "ANN-1", title: "Réunion parents", schoolCode: "SCH1", status: "Publiée" },
    { id: "ANN-2", title: "Fermeture exceptionnelle", schoolCode: "SCH2", status: "Publiée" },
    { id: "ANN-3", title: "Info système", systemBroadcast: true, status: "Publiée" },
  ],
  students: [
    { id: "STU-1", schoolCode: "SCH1", className: "6A", status: "Actif" },
    { id: "STU-2", schoolCode: "SCH1", className: "6B", status: "Actif" },
  ],
  teachers: [{ id: "TCH-1", schoolCode: "SCH1", status: "Actif" }],
  classes: [{ id: "CLS-1", name: "6A", schoolCode: "SCH1" }],
  payments: [{ id: "PAY-1", schoolCode: "SCH1", amount: 50_000, status: "Payé" }],
  presences: [{ id: "PRE-1", schoolCode: "SCH1", studentId: "STU-1", status: "Présent", present: true }],
  notes: [{ id: "NOTE-1", schoolCode: "SCH1", course: "Maths" }],
  messages: [{ id: "MSG-1", schoolCode: "SCH1", status: "Non lu" }],
  exams: [],
  bulletins: [],
  documents: [],
} as unknown as BackOfficeState;

const schoolAdmin: SessionUser = {
  id: "USR-ADM",
  role: "Admin School",
  schoolCode: "SCH1",
  firstName: "Admin",
  lastName: "École",
  identifier: "ADM-0001",
  scopeLevel: "Établissement",
  accessChannel: "Application",
  status: "Actif",
};

describe("Annonces — audience et publication", () => {
  it("filtre les annonces par établissement", () => {
    const scoped = scopedAnnouncements(schoolAdmin, state);
    const ids = scoped.map((row) => String(row.id));
    expect(ids).toContain("ANN-1");
    expect(ids).toContain("ANN-3");
    expect(ids).not.toContain("ANN-2");
  });

  it("autorise la communication plateforme au super admin", () => {
    const ctx: PermissionContext = {
      user: { ...schoolAdmin, role: "Super Administrateur Somafrik", schoolCode: "*" },
      rolePermissions: {},
    };
    expect(isPlatformCommunicationUser(ctx)).toBe(true);
    expect(isEstablishmentCommunicationUser(ctx)).toBe(false);
  });

  it("autorise la communication établissement au personnel local", () => {
    const ctx: PermissionContext = {
      user: { ...schoolAdmin, role: "Secrétaire" },
      rolePermissions: {},
    };
    expect(isEstablishmentCommunicationUser(ctx)).toBe(true);
  });

  it("compte les annonces non lues dans le périmètre", () => {
    const unread = countUnreadAnnouncements(schoolAdmin, state);
    expect(unread).toBeGreaterThan(0);
  });
});

describe("Tableau de bord — statistiques établissement", () => {
  const users: UserAccount[] = [
    {
      id: "USR-ADM",
      role: "Admin School",
      schoolCode: "SCH1",
      status: "Actif",
      identifier: "ADM-0001",
      firstName: "Admin",
      lastName: "École",
      scopeLevel: "Établissement",
      accessChannel: "Application",
    },
  ];

  it("compte les élèves, enseignants et classes par établissement", () => {
    const metrics = getEstablishmentMetrics(schoolAdmin, state, users);
    expect(metrics.students).toBe(2);
    expect(metrics.teachers).toBe(1);
    expect(metrics.classes).toBe(2);
    expect(metrics.payments).toBe(1);
    expect(metrics.notes).toBe(1);
    expect(metrics.unreadMessages).toBe(1);
  });

  it("isole les métriques à l'établissement connecté", () => {
    const otherSchoolUser: SessionUser = { ...schoolAdmin, schoolCode: "SCH2" };
    const metrics = getEstablishmentMetrics(otherSchoolUser, state, users);
    expect(metrics.students).toBe(0);
    expect(metrics.payments).toBe(0);
  });
});
