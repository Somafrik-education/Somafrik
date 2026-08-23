export type StudentDisplayNameInput = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  matricule?: string | null;
  id?: string | null;
};

function trimPart(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/** Nom affiché : firstName + lastName, sinon name, sinon matricule/id. Jamais firstName + name. */
export function studentDisplayName(student: StudentDisplayNameInput): string {
  const firstName = trimPart(student.firstName);
  const lastName = trimPart(student.lastName);
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  const name = trimPart(student.name);
  if (name) return name;
  return trimPart(student.matricule) || trimPart(student.id);
}
