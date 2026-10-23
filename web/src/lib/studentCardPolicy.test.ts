import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { PermissionContext } from "./permissions";
import {
  STUDENT_CARD_CR80,
  STUDENT_CARD_HOLDER_LABELS,
  STUDENT_CARD_HOLDER_UNDETERMINED_NOTICE,
  isStudentCardHolderDetermined,
  buildStudentCardPrintIdentity,
  canManageStudentCards,
  resolveStudentCardSettingsGate,
  studentCardActions,
  studentCardDocumentTitle,
  studentCardErrorMessage,
  studentCardPrintIdentityKeys,
  STUDENT_CARD_HOLDER_TITLES,
  STUDENT_CARD_SCREEN_PLACEHOLDERS,
  studentCardHolderTitle,
  studentCardNameStep,
  studentCardOptionalText,
  studentCardRef,
  studentCardValueStep,
} from "./studentCardPolicy";
import { buildStudentWorkspace } from "./studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "./studentWorkspaceViewModel";
import type { SchoolSettings } from "./schoolSettingsApi";

function settings(partial: Partial<SchoolSettings>): SchoolSettings {
  return {
    schoolCode: "CD-1",
    periodMode: "trimestre",
    defaultScale: 20,
    reportCardMode: "period",
    ...partial,
  };
}

function permissionCtx(permissions: string[]): PermissionContext {
  return {
    user: {
      id: "u-1",
      role: "Secrétaire",
      identifier: "sec@test.local",
      permissions,
      schoolCode: "CD-1",
    } as PermissionContext["user"],
    rolePermissions: {},
  };
}

describe("studentCardPolicy", () => {
  it("ferme l'émission si le master est absent, null ou faux", () => {
    expect(resolveStudentCardSettingsGate(null, true).state).toBe("unavailable");
    expect(resolveStudentCardSettingsGate(settings({})).state).toBe("disabled");
    expect(resolveStudentCardSettingsGate(settings({ studentCardEnabled: null as unknown as boolean })).state).toBe("disabled");
    expect(resolveStudentCardSettingsGate(settings({ studentCardEnabled: false })).state).toBe("disabled");
  });

  it("choisit qr, nfc_qr, ou refuse le NFC seul et l'absence de canal", () => {
    expect(resolveStudentCardSettingsGate(settings({
      studentCardEnabled: true,
      studentCardQrEnabled: false,
    }))).toMatchObject({ state: "ready", medium: null, nfcOnly: false });
    expect(resolveStudentCardSettingsGate(settings({
      studentCardEnabled: true,
      studentCardNfcEnabled: true,
    }))).toMatchObject({ state: "ready", medium: null, nfcOnly: true });
    expect(resolveStudentCardSettingsGate(settings({
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardNfcEnabled: true,
    }))).toMatchObject({ medium: "nfc_qr" });
    expect(resolveStudentCardSettingsGate(settings({
      studentCardEnabled: true,
      studentCardQrEnabled: true,
    }))).toMatchObject({ medium: "qr" });
  });

  it("limite les actions au cycle de vie", () => {
    expect(studentCardActions("active")).toEqual(["lost", "revoke", "replace"]);
    expect(studentCardActions("lost")).toEqual(["replace"]);
    expect(studentCardActions("revoked")).toEqual([]);
    expect(studentCardActions("replaced")).toEqual([]);
    expect(studentCardActions("issued")).toEqual([]);
  });

  it("autorise les mutations par Élèves UPDATE ou Gérer élèves, pas par le nom de rôle", () => {
    expect(canManageStudentCards(permissionCtx(["Élèves:READ"]))).toBe(false);
    expect(canManageStudentCards(permissionCtx(["Élèves:UPDATE"]))).toBe(true);
    expect(canManageStudentCards(permissionCtx(["Gérer élèves"]))).toBe(true);
  });

  it("traduit les erreurs carte sans reprendre le message brut", () => {
    expect(studentCardErrorMessage(new ApiError("élève B secret", 409, "STUDENT_CARD_ACTIVE_ALREADY_EXISTS")))
      .toBe("Une carte active existe déjà. La liste a été actualisée.");
    expect(studentCardErrorMessage(new ApiError("détail", 403, "PLATFORM_PERSONAL_DATA_DENIED"))).toBe("Accès refusé.");
    expect(studentCardErrorMessage(new ApiError("fuite", 404, "STUDENT_CARD_NOT_FOUND"))).not.toContain("fuite");
  });

  it("prépare une identité imprimée sans données interdites", () => {
    const identity = buildStudentCardPrintIdentity({
      displayName: "Kabila Amina",
      classLabel: "6ème A",
      studentCode: "CD-001",
      schoolName: "Lycée Test",
      photoUrl: "https://exemple.test/photo.jpg",
      publicId: "CARD-A",
    });
    expect(Object.keys(identity).sort()).toEqual([...studentCardPrintIdentityKeys()].sort());
    expect(JSON.stringify(identity)).not.toMatch(/parentPhone|parentEmail|birthDate|token_hash|cardToken|schoolId/);
    expect(studentCardDocumentTitle("CD-001")).toBe("Carte-eleve-CD-001");
    expect(studentCardDocumentTitle("CD 001")).toBe("Carte-eleve-CD-001");
    expect(studentCardDocumentTitle("CD-001", "etudiant")).toBe("Carte-etudiant-CD-001");
    expect(studentCardDocumentTitle(null, "eleve")).toBe("Carte-eleve-eleve");
    expect(STUDENT_CARD_CR80).toEqual({ width: "85.60mm", height: "53.98mm" });
  });
});

describe("CARTE-CYCLE-01 — titulaire de carte", () => {
  it("seuls « eleve » et « etudiant » autorisent une émission (absent ou inconnu = non déterminé)", () => {
    expect(isStudentCardHolderDetermined({ kind: "eleve", source: "school_type" })).toBe(true);
    expect(isStudentCardHolderDetermined({ kind: "etudiant", source: "level_setting" })).toBe(true);
    for (const holder of [null, undefined, { kind: null, source: null }, { kind: "Eleve", source: null }] as never[]) {
      expect(isStudentCardHolderDetermined(holder)).toBe(false);
    }
  });

  it("le refus serveur STUDENT_CARD_HOLDER_UNDETERMINED reçoit un message dédié", () => {
    const message = studentCardErrorMessage(new ApiError("x", 409, "STUDENT_CARD_HOLDER_UNDETERMINED"));
    expect(message).toBe(STUDENT_CARD_HOLDER_UNDETERMINED_NOTICE);
    expect(STUDENT_CARD_HOLDER_LABELS).toEqual({ eleve: "Élève", etudiant: "Étudiant" });
  });
});

describe("CARTE-UI-01 — présentation de la carte", () => {
  it("en-tête imprimé : uniquement depuis le titulaire résolu par le Backend", () => {
    expect(STUDENT_CARD_HOLDER_TITLES).toEqual({ eleve: "CARTE D’ÉLÈVE", etudiant: "CARTE D’ÉTUDIANT" });
    expect(studentCardHolderTitle({ kind: "eleve", source: "school_type" })).toBe("CARTE D’ÉLÈVE");
    expect(studentCardHolderTitle({ kind: "etudiant", source: "level_setting" })).toBe("CARTE D’ÉTUDIANT");
    for (const holder of [null, undefined, { kind: null, source: null }, { kind: "Etudiant", source: null }, { kind: "student", source: null }] as never[]) {
      expect(studentCardHolderTitle(holder)).toBeNull();
    }
  });

  it("référence de carte abrégée aux 6 derniers caractères de l'identifiant public", () => {
    expect(studentCardRef("Q2FydGVEZW1vTm9uVmFsaWQ")).toBe("mFsaWQ");
    expect(studentCardRef("Q2FydGVEZW1vTm9uVmFsaWQ")).toHaveLength(6);
    expect(studentCardRef("  ABC  ")).toBe("ABC");
    expect(studentCardRef(null)).toBe("");
  });

  it("les libellés d'écran de donnée manquante ne sont jamais imprimés (verrouillés sur le view model réel)", () => {
    const workspace = buildStudentWorkspace({
      studentId: "CD-UI-01",
      academicYear: "2026-2027",
      data: { students: [{ id: "CD-UI-01", matricule: "", schoolCode: "CD-UI", firstName: "Awa", lastName: "Diallo", birthDate: "", enrollmentDate: "" } as never] },
    });
    expect(workspace).not.toBeNull();
    const vm = buildStudentWorkspaceViewModel(workspace!);
    for (const label of [vm.classLabel, vm.enrollmentStatusLabel]) {
      expect(STUDENT_CARD_SCREEN_PLACEHOLDERS).toContain(label);
      expect(studentCardOptionalText(label)).toBeNull();
    }
    for (const empty of ["", "   ", null, undefined, "Non renseigné", " Aucune inscription active "]) {
      expect(studentCardOptionalText(empty)).toBeNull();
    }
    expect(studentCardOptionalText(" 6ème A ")).toBe("6ème A");
    const identity = buildStudentCardPrintIdentity({
      displayName: "Awa Diallo",
      classLabel: "Non renseigné",
      studentCode: "Non renseigné",
      schoolName: "",
      photoUrl: "  ",
      publicId: "CARD-A",
    });
    expect(identity).toEqual({ displayName: "Awa Diallo", classLabel: null, studentCode: null, schoolName: null, photoUrl: null, publicId: "CARD-A" });
  });

  it("paliers typographiques : le nom diminue par paliers au lieu d'être tronqué", () => {
    expect(studentCardNameStep("Awa Diallo")).toBe("l1");
    expect(studentCardNameStep("Mukendi Kabongo Ngalula Marie")).toBe("l2");
    expect(studentCardNameStep("Mukendi Kabongo Ngalula Marie-Josée Tshibanda")).toBe("l3");
    expect(studentCardNameStep("Mukendi Kabongo Ngalula Marie-Josée Tshibanda Wa Kalombo Ilunga")).toBe("l4");
    expect(studentCardValueStep("CD-KIN-SE-26-0042", 16)).toBe("l2");
    expect(studentCardValueStep("CD-001", 16)).toBe("l1");
  });
});
