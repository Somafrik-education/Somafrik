import { api } from "../api/client";

export type CommunicationChannel = "IN_APP" | "PUSH" | "EMAIL";

export type CommunicationChannels = Record<CommunicationChannel, boolean>;

export type CommunicationPreferencesResponse = {
  schoolId: string;
  channels: CommunicationChannels;
};

export function getCommunicationPreferences() {
  return api.get<CommunicationPreferencesResponse>("/me/communication-preferences");
}

export function updateCommunicationPreferences(channels: Partial<CommunicationChannels>) {
  return api.put<CommunicationPreferencesResponse>("/me/communication-preferences", { channels });
}
