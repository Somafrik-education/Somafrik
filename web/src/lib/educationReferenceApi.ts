import { api } from "../api/client";

export type EducationLevel = {
  id: string;
  countryCode: string;
  code: string;
  name: string;
  displayOrder: number;
  status: "active" | "archived";
  schoolActive?: boolean;
};

export type EducationStream = {
  id: string;
  countryCode: string;
  levelId?: string | null;
  code: string;
  name: string;
  streamType: "filiere" | "serie" | "option";
  displayOrder: number;
  status: "active" | "archived";
  schoolActive?: boolean;
};

export type EducationPedagogicalLabels = {
  levelLabel: string;
  trackLabel: string;
  groupLabel: string;
};

export type EducationSchoolCatalog = {
  schoolCode: string;
  countryCode: string;
  labels?: EducationPedagogicalLabels;
  levels: EducationLevel[];
  streams: EducationStream[];
};

export const educationReferenceApi = {
  listLevels: (countryCode: string, includeArchived = false) =>
    api.get<{ levels: EducationLevel[] }>(
      `/backoffice/education-levels?countryCode=${encodeURIComponent(countryCode)}&includeArchived=${includeArchived}`,
    ),
  createLevel: (payload: Record<string, unknown>) => api.post<EducationLevel>("/backoffice/education-levels", payload),
  updateLevel: (levelId: string, payload: Record<string, unknown>) =>
    api.patch<EducationLevel>(`/backoffice/education-levels/${encodeURIComponent(levelId)}`, payload),
  archiveLevel: (levelId: string) =>
    api.post<EducationLevel>(`/backoffice/education-levels/${encodeURIComponent(levelId)}/archive`, {}),

  listStreams: (countryCode: string, streamType?: string) =>
    api.get<{ streams: EducationStream[] }>(
      `/backoffice/education-streams?countryCode=${encodeURIComponent(countryCode)}${streamType ? `&streamType=${encodeURIComponent(streamType)}` : ""}`,
    ),
  createStream: (payload: Record<string, unknown>) => api.post<EducationStream>("/backoffice/education-streams", payload),
  updateStream: (streamId: string, payload: Record<string, unknown>) =>
    api.patch<EducationStream>(`/backoffice/education-streams/${encodeURIComponent(streamId)}`, payload),
  archiveStream: (streamId: string) =>
    api.post<EducationStream>(`/backoffice/education-streams/${encodeURIComponent(streamId)}/archive`, {}),

  getSchoolCatalog: (schoolCode?: string) =>
    schoolCode
      ? api.get<EducationSchoolCatalog>(
          `/backoffice/establishments/${encodeURIComponent(schoolCode)}/education-reference/catalog`,
        )
      : api.get<EducationSchoolCatalog>("/education-reference/catalog"),

  saveSchoolActivation: (payload: { levelIds: string[]; streamIds: string[] }, schoolCode?: string) =>
    schoolCode
      ? api.put<EducationSchoolCatalog>(
          `/backoffice/establishments/${encodeURIComponent(schoolCode)}/education-reference/school-activation`,
          payload,
        )
      : api.put<EducationSchoolCatalog>("/education-reference/school-activation", payload),

  updateCountryLabels: (payload: EducationPedagogicalLabels & { countryCode: string }) =>
    api.patch<EducationPedagogicalLabels & { countryCode: string }>("/backoffice/education-reference/labels", payload),
};
