import { ErrorState, ForbiddenState } from "@/design-system";
import { Button } from "../ui/Button";
import {
  communicationHttpErrorView,
  usesForbiddenCommunicationState,
} from "../../lib/communicationHttpError";

export function CommunicationHttpErrorState({
  error,
  fallbackMessage,
  onRetry,
}: {
  error: unknown;
  fallbackMessage: string;
  onRetry?: () => void;
}) {
  const view = communicationHttpErrorView(error, fallbackMessage);
  const message = view.httpLabel ? `${view.message} ${view.httpLabel}` : view.message;
  const action = onRetry ? (
    <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
      Réessayer
    </Button>
  ) : undefined;
  const shared = {
    title: view.title,
    message,
    action,
    "data-testid": "communication-http-error" as const,
    "data-http-status": view.status == null ? "unknown" : String(view.status),
    "data-http-kind": view.kind,
  };

  if (usesForbiddenCommunicationState(view.kind)) {
    return <ForbiddenState {...shared} />;
  }
  return <ErrorState {...shared} />;
}
