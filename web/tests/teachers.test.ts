import { describe, it, expect } from "vitest";

import {
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../src/lib/assignments";
import { validateCourseTeacherRule, canSchoolAdminMutateTeachers } from "../src/lib/pedagogyGovernance";
import { validateTeacherDeletion, validateTeacherSchoolEntry } from "../src/lib/teacherRules";
import {
  getLinkableTeacherUserOptions,
  getTeacherProvisioningOptions,
  parseTeacherProvisioningSelection,
  syncTeacherProfileToUser,
  upsertTeacherFromUser,
} from "../src/lib/userTeacherSync";
import type { BackOfficeState, UserAccount } from "../src/types";

const teachers = [
  { id: "TCH-1", firstName: "Paul", name: "Mukendi", schoolCode: "SCH1" },
  { id: "TCH-2", firstName: "Marie", name: "Kabila", schoolCode: "SCH1" },
];

const classes = [{ id: "CLS-1", name: "6A", schoolCode: "SCH1" }];

const courses = [{ id: "CRS-1", name: "Maths", className: "6A", schoolCode: "SCH1" }];

const assignments = [
  { id: "ASG-1", teacherId: "TCH-1", teacherName: "Paul Mukendi", className: "6A", subject: "Maths", schoolCode: "SCH1" },
];

const state = {
  schools: [{ code: "SCH1", name: "École 1" }],
  classes,
  courses,
  assignments,
  teachers,
  academicConfigs: {
    SCH1: {
      classNames: ["6A"],
      subjectsByClass: { "6A": ["Maths", "Français"] },
      userRoles: ["Enseignant"],
    },
  },
} as unknown as BackOfficeState;

describe("Enseignants — affectations", () => {
  it("prépare une affectation valide", () => {
    const prepared = prepareAssignmentForSave(
      { teacherId: "TCH-1", className: "6A", subject: "Français" },
      teachers,
      "SCH1",
      state,
    );
    expect(prepared.teacherName).toBe("Paul Mukendi");
    expect(prepared.schoolCode).toBe("SCH1");
    expect(prepared.course).toBe("Français");
  });

  it("rejette une affectation sans enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/enseignant/i);
  });

  it("rejette une affectation en doublon pour le même enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "TCH-1", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/déjà affecté/i);
  });

  it("rejette une affectation en conflit avec un autre enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "TCH-2", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/autre enseignant/i);
  });

  it("applique la règle un cours = un enseignant", () => {
    expect(
      validateCourseTeacherRule(
        { className: "6A", name: "Maths", teacherId: "TCH-2" },
        courses,
        assignments,
      ),
    ).toMatch(/déjà affecté/i);
  });

  it("autorise Admin School à consulter, créer et mettre à jour les enseignants", () => {
    expect(canSchoolAdminMutateTeachers("CREATE")).toBe(true);
    expect(canSchoolAdminMutateTeachers("READ")).toBe(true);
    expect(canSchoolAdminMutateTeachers("UPDATE")).toBe(true);
    expect(canSchoolAdminMutateTeachers("DELETE")).toBe(false);
  });

  it("refuse la suppression d'un enseignant avec affectations", () => {
    const message = validateTeacherDeletion(state, teachers[0]);
    expect(message).toMatch(/affectation|matière/i);
  });

  it("accepte une date d'entrée à partir des 18 ans", () => {
    expect(
      validateTeacherSchoolEntry({
        birthDate: "15-03-1985",
        entryDate: "01-09-2020",
      }),
    ).toBeNull();
  });

  it("refuse une date d'entrée antérieure à la naissance", () => {
    expect(
      validateTeacherSchoolEntry({
        birthDate: "15-03-1985",
        entryDate: "01-01-1980",
      }),
    ).toMatch(/naissance/i);
  });

  it("refuse une date d'entrée avant les 18 ans", () => {
    expect(
      validateTeacherSchoolEntry({
        birthDate: "15-03-2008",
        entryDate: "01-09-2025",
      }),
    ).toMatch(/18 ans/i);
  });

  it("accepte une date d'entrée le jour des 18 ans", () => {
    expect(
      validateTeacherSchoolEntry({
        birthDate: "15-03-2008",
        entryDate: "15-03-2026",
      }),
    ).toBeNull();
  });

  it("autorise l'enregistrement sans date de naissance si pas de date d'entrée", () => {
    expect(
      validateTeacherSchoolEntry({
        birthDate: "",
        entryDate: "",
      }),
    ).toBeNull();
  });

  it("propose les comptes enseignant sans fiche opérationnelle", () => {
    const users = [
      {
        id: "USR-1",
        role: "Enseignant",
        identifier: "ENS-0003",
        firstName: "Jean",
        lastName: "KABONGO",
        schoolCode: "SCH1",
      },
    ] as UserAccount[];
    const options = getLinkableTeacherUserOptions(
      { ...state, users, teachers } as BackOfficeState,
      "SCH1",
    );
    expect(options).toHaveLength(1);
    expect(options[0]?.label).toContain("Jean");
  });

  it("fusionne contacts et comptes pour le provisionnement enseignant", () => {
    const users = [
      {
        id: "USR-9",
        role: "Enseignant",
        identifier: "ENS-0009",
        firstName: "Aline",
        lastName: "MUKENDI",
        schoolCode: "SCH1",
      },
    ] as UserAccount[];
    const contacts = [
      {
        id: "CT-1",
        contactType: "Enseignant",
        firstName: "Paul",
        lastName: "LUMU",
        schoolCode: "SCH1",
      },
    ];
    const options = getTeacherProvisioningOptions(
      { ...state, users, contacts } as unknown as BackOfficeState,
      "SCH1",
      [{ value: "CT-1", label: "Paul LUMU" }],
    );
    expect(options).toHaveLength(2);
    expect(options.some((row) => row.value === "user:USR-9")).toBe(true);
    expect(options.some((row) => row.value === "contact:CT-1")).toBe(true);
  });

  it("parse la sélection contact ou compte utilisateur", () => {
    expect(parseTeacherProvisioningSelection("user:USR-1")).toEqual({
      kind: "user",
      id: "USR-1",
    });
    expect(parseTeacherProvisioningSelection("contact:CT-1")).toEqual({
      kind: "contact",
      id: "CT-1",
    });
    expect(parseTeacherProvisioningSelection("CT-LEGACY")).toEqual({
      kind: "contact",
      id: "CT-LEGACY",
    });
  });

  it("synchronise le profil enseignant vers le compte utilisateur lié", () => {
    const users = [
      {
        id: "USR-1",
        identifier: "ENS-0001",
        firstName: "Paul",
        lastName: "Mukendi",
        phone: "",
        email: "",
      },
    ] as UserAccount[];
    const next = syncTeacherProfileToUser(users, {
      userId: "USR-1",
      name: "Mukendi",
      firstName: "Paul",
      phone: "+243 900 000 001",
      email: "paul@ecole.cd",
      birthDate: "01-01-1985",
      gender: "Masculin",
      publicId: "SCH1-ENS-0001",
    });
    expect(next[0]?.phone).toBe("+243 900 000 001");
    expect(next[0]?.email).toBe("paul@ecole.cd");
    expect(next[0]?.birthDate).toBe("01-01-1985");
  });

  it("crée une fiche enseignant avec le préfixe TEACHERS-", () => {
    const user = {
      id: "USR-NEW",
      role: "Enseignant",
      identifier: "ENS-0005",
      firstName: "Claire",
      lastName: "BORA",
      schoolCode: "SCH1",
    } as UserAccount;
    const rows = upsertTeacherFromUser([], user);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.id ?? "")).toMatch(/^TEACHERS-/);
    expect(rows[0]?.identifier).toBe("ENS-0005");
  });
});
