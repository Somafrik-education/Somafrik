import { ApiError } from "../api/client";

export type CommunicationHttpErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "server"
  | "error";

export type CommunicationHttpErrorView = {
  status: number | null;
  kind: CommunicationHttpErrorKind;
  title: string;
  message: string;
  httpLabel: string | null;
};

export const COMMUNICATION_HTTP_ERROR_COPY = {
  401: {
    kind: "unauthenticated" as const,
    title: "Session expirée",
    message: "Reconnectez-vous pour continuer.",
  },
  403: {
    kind: "forbidden" as const,
    title: "Accès refusé",
    message: "Vous n'avez pas les droits nécessaires pour afficher ce contenu.",
  },
  404: {
    kind: "not_found" as const,
    title: "Ressource introuvable",
    message: "Cette conversation, annonce ou notification n'existe pas ou n'est plus disponible.",
  },
  409: {
    kind: "conflict" as const,
    title: "Conflit",
    message: "L'état a changé. Actualisez puis réessayez.",
  },
  500: {
    kind: "server" as const,
    title: "Erreur serveur",
    message: "Le service Communication est temporairement indisponible. Réessayez.",
  },
} as const;

function copyForStatus(status: number) {
  if (status === 401) return COMMUNICATION_HTTP_ERROR_COPY[401];
  if (status === 403) return COMMUNICATION_HTTP_ERROR_COPY[403];
  if (status === 404) return COMMUNICATION_HTTP_ERROR_COPY[404];
  if (status === 409) return COMMUNICATION_HTTP_ERROR_COPY[409];
  if (status >= 500) return COMMUNICATION_HTTP_ERROR_COPY[500];
  return null;
}

export function communicationHttpErrorView(
  error: unknown,
  fallbackMessage = "Impossible de charger les données de communication.",
): CommunicationHttpErrorView {
  const status = error instanceof ApiError ? error.status : null;
  const copy = status != null ? copyForStatus(status) : null;
  if (copy) {
    return {
      status,
      kind: copy.kind,
      title: copy.title,
      message: copy.message,
      httpLabel: `HTTP ${status}`,
    };
  }
  const message =
    error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
  return {
    status,
    kind: "error",
    title: "Une erreur est survenue",
    message,
    httpLabel: status != null ? `HTTP ${status}` : null,
  };
}

export function usesForbiddenCommunicationState(kind: CommunicationHttpErrorKind): boolean {
  return kind === "forbidden" || kind === "unauthenticated";
}
