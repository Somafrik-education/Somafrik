import { api } from "../api/client";

export type SchoolSubject = {
  id?: string;
  code: string;
  subjectCode?: string;
  name: string;
  status?: string;
  schoolCode?: string;
};

function asList(payload: unknown): SchoolSubject[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const code = String(item.code ?? item.subjectCode ?? item.publicId ?? "").trim();
      const name = String(item.name ?? item.subject ?? "").trim();
      return {
        id: item.id != null ? String(item.id) : undefined,
        code,
        subjectCode: code,
        name,
        status: String(item.status ?? "active"),
        schoolCode: item.schoolCode != null ? String(item.schoolCode) : undefined,
      };
    })
    .filter((row) => row.code && row.name);
}

export function isArchivedSubjectStatus(status: string | undefined): boolean {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .includes("archiv");
}

export const subjectsApi = {
  async list(): Promise<SchoolSubject[]> {
    const payload = await api.get<unknown>("/v2/subjects");
    return asList(payload);
  },
  create(payload: { name: string; code: string; coefficient?: number; status?: string; level?: string }) {
    return api.post<{ id?: string; message?: string }>("/v2/subjects", payload);
  },
};
