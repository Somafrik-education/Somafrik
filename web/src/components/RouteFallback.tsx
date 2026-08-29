import { LoadingState } from "@/design-system";

export function RouteFallback() {
  return <LoadingState className="min-h-[40vh]" message="Chargement de l’espace…" />;
}
