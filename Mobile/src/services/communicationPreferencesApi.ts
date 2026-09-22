import { httpRequest } from "./httpClient";

export type CommunicationChannel = "IN_APP" | "PUSH" | "EMAIL";
export type CommunicationChannels = Record<CommunicationChannel, boolean>;

export type CommunicationPreferencesResponse = {
  schoolId: string;
  channels: CommunicationChannels;
};

export function getCommunicationPreferences() {
  return httpRequest<CommunicationPreferencesResponse>("/me/communication-preferences");
}

export function updateCommunicationPreferences(channels: Partial<CommunicationChannels>) {
  return httpRequest<CommunicationPreferencesResponse>("/me/communication-preferences", {
    method: "PUT",
    body: JSON.stringify({ channels }),
  });
}
