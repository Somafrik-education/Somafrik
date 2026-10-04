import { describe, expect, it } from "vitest";
import {
  formatMessageRoleLabel,
  hasStudentParticipant,
  isStudentMessageTarget,
  isTeacherMessagingSession,
} from "./messagesRoleIdentity";

describe("messagesRoleIdentity — roleKey/kind only", () => {
  it("détecte un élève par roleKey ou kind, jamais par roleLabel", () => {
    expect(isStudentMessageTarget({ roleKey: "STUDENT", roleLabel: "Apprenant" })).toBe(true);
    expect(isStudentMessageTarget({ kind: "student", roleLabel: "Directeur" })).toBe(true);
    expect(isStudentMessageTarget({ roleLabel: "Élève / Étudiant" })).toBe(false);
    expect(isStudentMessageTarget({ roleLabel: "Étudiant" })).toBe(false);
    expect(hasStudentParticipant([{ roleKey: "STUDENT", roleLabel: "Apprenant" }])).toBe(true);
    expect(hasStudentParticipant([{ roleLabel: "Élève / Étudiant" }])).toBe(false);
  });

  it("détecte une session enseignant uniquement via roleKeys/roleKey", () => {
    expect(isTeacherMessagingSession({ roleKeys: ["TEACHER"] })).toBe(true);
    expect(isTeacherMessagingSession({ roleKey: "TEACHER" })).toBe(true);
    expect(isTeacherMessagingSession({ roleKeys: ["SCHOOL_ADMIN"] })).toBe(false);
  });

  it("affiche le roleLabel serveur tel quel", () => {
    expect(formatMessageRoleLabel({ roleLabel: "Professeur" })).toBe("Professeur");
    expect(formatMessageRoleLabel({ roleLabel: "Étudiant" })).toBe("Étudiant");
  });
});
