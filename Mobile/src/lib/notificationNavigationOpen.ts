import {
  constrainParentPushNavigation,
  type AllowedPushDestination,
  type AllowedPushNavigationParams,
  type NotificationNavigationMeta,
  type ResolvedNotificationNavigation,
} from "./pushNotificationDestinations";
import { constrainPlatformSchoolNavigation } from "./platformSchoolDomainDeny";
import {
  collectRegisteredRouteNames,
  dispatchRegisteredPushNavigation,
  resolveRegisteredPushDestination,
} from "./pushNotificationNavigate";

/**
 * NOTIF-MOBILE-NAV — ouverture commune d'une notification résolue (Push et centre in-app).
 *
 * Ordre : contexte d'établissement → périmètre parent → domaine plateforme →
 * route enregistrée pour la session. Seule une ouverture qui atteint la ressource
 * visée déclenche le marquage lu ; un refus ne navigue que vers l'accueil.
 */

type SessionLike = {
  role?: string | null;
  user?: { id?: string | null; schoolCode?: string | null; children?: unknown } | null;
  school?: { code?: string | null } | null;
} | null | undefined;

type NavigationRefLike = {
  isReady?: () => boolean;
  navigate: (...args: never[]) => unknown;
  getRootState?: () => unknown;
};

export type NotificationOpenRefusal =
  | "unresolved"
  | "school_mismatch"
  | "parent_scope"
  | "platform_scope"
  | "route_unavailable";

export type NotificationOpenDecision =
  | {
      ok: true;
      destination: AllowedPushDestination;
      params?: AllowedPushNavigationParams;
      /** Notification à marquer lue, avec l'établissement de la session. */
      markRead?: { notificationId: string; schoolCode: string };
      /** Élève à présélectionner pour un écran sans paramètre élève (bulletins). */
      selectStudentId?: string;
    }
  | { ok: false; reason: NotificationOpenRefusal };

const SCHOOL_CODE = /^[A-Za-z0-9_-]{1,80}$/;

/** Établissement de la session, ou chaîne vide (aucun, ou portée plateforme `*`). */
export function sessionSchoolCode(session: SessionLike): string {
  const raw = String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
  return SCHOOL_CODE.test(raw) ? raw.toUpperCase() : "";
}

function contextSchoolCode(session: SessionLike, override?: string | null): string {
  const raw = String(override ?? "").trim();
  if (raw) return SCHOOL_CODE.test(raw) ? raw.toUpperCase() : "";
  return sessionSchoolCode(session);
}

function schoolAllowed(meta: NotificationNavigationMeta, current: string): boolean {
  if (meta.invalidSchoolCode) return false;
  if (!meta.schoolCode) return true; // ancien Push sans contexte : le serveur reste juge
  return Boolean(current) && current === meta.schoolCode;
}

/** Noms de routes enregistrés pour la session courante (vide si la navigation n'est pas prête). */
export function registeredRouteNamesOf(navigation: NavigationRefLike): Set<string> {
  if (typeof navigation.isReady === "function" && !navigation.isReady()) return new Set();
  return collectRegisteredRouteNames(navigation.getRootState?.() as never);
}

/** Décision pure : aucune navigation, aucun appel réseau. */
export function decideNotificationOpen(
  resolved: ResolvedNotificationNavigation,
  session: SessionLike,
  registeredRouteNames: Iterable<string>,
  options: { schoolCode?: string | null } = {},
): NotificationOpenDecision {
  if (!resolved.resolved) return { ok: false, reason: "unresolved" };
  const schoolCode = contextSchoolCode(session, options.schoolCode);
  if (!schoolAllowed(resolved.meta, schoolCode)) return { ok: false, reason: "school_mismatch" };

  const parentScoped = constrainParentPushNavigation(
    { destination: resolved.destination, params: resolved.params },
    session as never,
  );
  if (parentScoped.destination !== resolved.destination) return { ok: false, reason: "parent_scope" };

  const platformScoped = constrainPlatformSchoolNavigation(parentScoped, session);
  if (platformScoped.destination !== resolved.destination) return { ok: false, reason: "platform_scope" };

  if (resolveRegisteredPushDestination(resolved.destination, registeredRouteNames) !== resolved.destination) {
    return { ok: false, reason: "route_unavailable" };
  }

  const decision: NotificationOpenDecision = { ok: true, destination: resolved.destination };
  if (resolved.params) decision.params = resolved.params;
  if (resolved.meta.notificationId && schoolCode) {
    decision.markRead = { notificationId: resolved.meta.notificationId, schoolCode };
  }
  if (resolved.destination === "ReportCards" && resolved.params?.studentId && session?.role === "parent_student") {
    decision.selectStudentId = resolved.params.studentId;
  }
  return decision;
}

export type NotificationOpenDeps = {
  navigation: NavigationRefLike;
  /** Établissement de contexte (centre in-app : établissement actif). Défaut : session. */
  schoolCode?: string | null;
  markRead?: (notificationId: string, schoolCode: string) => Promise<unknown>;
  /** L'identité compte doit isoler la déduplication entre deux sessions. */
  accountId?: string | null;
  onReadChanged?: () => void;
  selectStudent?: (studentId: string) => void;
};

const readRequested = new Set<string>();

export function resetNotificationOpenStateForTests() {
  readRequested.clear();
}

/**
 * Marquage lu idempotent : un seul appel par notification et par établissement
 * pendant la vie du processus. Une erreur réseau libère la clé (nouvel essai
 * possible) sans jamais modifier la navigation déjà décidée.
 */
async function markReadOnce(
  target: { notificationId: string; schoolCode: string },
  deps: NotificationOpenDeps,
): Promise<void> {
  if (typeof deps.markRead !== "function") return;
  const key = `${deps.accountId || "legacy-session"}:${target.schoolCode}:${target.notificationId}`;
  if (readRequested.has(key)) return;
  readRequested.add(key);
  try {
    await deps.markRead(target.notificationId, target.schoolCode);
    deps.onReadChanged?.();
  } catch {
    readRequested.delete(key);
  }
}

/**
 * Ouvre une notification résolue. Push : un refus mène à l'accueil (fail-closed).
 * Retourne la décision pour que l'appelant puisse informer l'utilisateur.
 */
export function openResolvedNotification(
  resolved: ResolvedNotificationNavigation,
  session: SessionLike,
  deps: NotificationOpenDeps,
  options: { onRefused?: "home" | "stay" } = {},
): NotificationOpenDecision {
  const { navigation } = deps;
  if (typeof navigation.isReady === "function" && !navigation.isReady()) {
    return { ok: false, reason: "route_unavailable" };
  }
  const routeNames = registeredRouteNamesOf(navigation);
  const decision = decideNotificationOpen(resolved, session, routeNames, { schoolCode: deps.schoolCode });
  if (!decision.ok) {
    if ((options.onRefused ?? "home") === "home") {
      dispatchRegisteredPushNavigation(navigation, "Home");
    }
    return decision;
  }
  if (decision.selectStudentId) deps.selectStudent?.(decision.selectStudentId);
  dispatchRegisteredPushNavigation(navigation, decision.destination, decision.params);
  if (decision.markRead) {
    void markReadOnce(decision.markRead, {
      ...deps,
      accountId: session?.user?.id || deps.accountId,
    });
  }
  return decision;
}
