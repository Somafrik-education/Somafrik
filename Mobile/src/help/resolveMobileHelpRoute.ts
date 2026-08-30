/**
 * Résout le nom de route feuille pour le catalogue HELP.
 * Les onglets Accueil / Enseignants / Utilisateurs sont des alias d'écrans déjà mappés.
 */

export type NavStateLike = {
  index?: number;
  routes?: Array<{ name?: string; state?: NavStateLike }>;
} | null | undefined;

const TAB_ALIASES: Record<string, string> = Object.freeze({
  Accueil: "Home",
  Enseignants: "Teachers",
  Utilisateurs: "Users",
});

export const PUBLIC_HELP_BLOCKED_ROUTES = Object.freeze([
  "Welcome",
  "RoleSelection",
  "Login",
  "Support",
  "Permissions",
  "PermissionsBootstrap",
  "ConfigurationError",
  "ConfigurationErrorScreen",
]);

export function getLeafRouteName(state: NavStateLike): string | null {
  if (!state || !Array.isArray(state.routes) || state.routes.length === 0) return null;
  const index = Number.isInteger(state.index) ? Number(state.index) : 0;
  const route = state.routes[index] ?? state.routes[0];
  if (!route) return null;
  if (route.state) return getLeafRouteName(route.state);
  return typeof route.name === "string" && route.name.trim() ? route.name : null;
}

export function catalogRouteName(routeName: string | null | undefined): string | null {
  if (typeof routeName !== "string" || routeName.trim() === "") return null;
  const name = routeName.trim();
  return TAB_ALIASES[name] ?? name;
}

export function isPublicOrBootstrapRoute(routeName: string | null | undefined): boolean {
  const name = catalogRouteName(routeName) ?? (typeof routeName === "string" ? routeName.trim() : "");
  return PUBLIC_HELP_BLOCKED_ROUTES.includes(name);
}
