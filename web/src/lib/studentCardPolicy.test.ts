import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { PermissionContext } from "./permissions";
import {
  STUDENT_CARD_CR80,
  buildStudentCardPrintIdentity,
  canManageStudentCards,
  resolveStudentCardSettingsGate,
  studentCardActions,
  studentCardDocumentTitle,
  studentCardErrorMessage,
  studentCardPrintIdentityKeys,
} from "./studentCardPolicy";
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
    expect(STUDENT_CARD_CR80).toEqual({ width: "85.60mm", height: "53.98mm" });
  });
});
