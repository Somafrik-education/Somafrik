/** Recherche locale sur les enseignants déjà autorisés par la projection canonique. */
export type SearchableTeacher = { name?: string | null; teacherCode?: string | null; publicId?: string | null };

export function normalizeDirectoryQuery(value: unknown): string {
  return String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function filterTeachersForSearch<T extends SearchableTeacher>(teachers: T[], query: string): T[] {
  const term = normalizeDirectoryQuery(query);
  if (!term) return teachers;
  return teachers.filter((teacher) => [teacher.name, teacher.teacherCode, teacher.publicId]
    .some((value) => normalizeDirectoryQuery(value).includes(term)));
}
