import {
  HELP_PLATFORM,
  HELP_SCREEN,
  normalizeHelpRole,
  normalizeHelpText,
} from "./constants.js";
import { moduleForScreen, resolveHelpScreen } from "./screens.js";

const FORBIDDEN_CONTEXT_KEYS = Object.freeze([
  "jwt",
  "token",
  "password",
  "motDePasse",
  "studentId",
  "studentName",
  "children",
  "googleServices",
]);

const ALLOWED_CONTEXT_KEYS = Object.freeze(
  Object.assign(Object.create(null), {
    platform: true,
    screen: true,
    module: true,
    role: true,
    permissions: true,
    pathname: true,
    routeName: true,
  }),
);

function asOwnObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input;
}

function rejectForbiddenKeys(input) {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol") continue;
    const normalized = normalizeHelpText(key).replace(/[_-]/g, "");
    if (FORBIDDEN_CONTEXT_KEYS.some((forbidden) => normalizeHelpText(forbidden).replace(/[_-]/g, "") === normalized)) {
      throw new Error(`help context must not include ${key}`);
    }
  }
}

function freezePermissions(permissions) {
  if (!Array.isArray(permissions)) return Object.freeze([]);
  const tokens = [];
  for (const permission of permissions) {
    if (typeof permission !== "string") continue;
    const token = permission.trim();
    if (token) tokens[tokens.length] = token;
  }
  return Object.freeze(tokens);
}

export function createHelpContext(input) {
  const raw = asOwnObject(input);
  rejectForbiddenKeys(raw);

  const platform = raw.platform === HELP_PLATFORM.MOBILE ? HELP_PLATFORM.MOBILE : HELP_PLATFORM.WEB;
  const role = normalizeHelpRole(raw.role);
  const screen =
    raw.screen === null
      ? null
      : typeof raw.screen === "string" && Object.values(HELP_SCREEN).includes(raw.screen)
        ? raw.screen
        : resolveHelpScreen({
            platform,
            pathname: raw.pathname,
            routeName: raw.routeName,
            role: raw.role,
          });
  const module = typeof raw.module === "string" && raw.module.trim() ? raw.module.trim() : moduleForScreen(screen);
  const permissions = freezePermissions(raw.permissions);

  const context = Object.freeze({
    platform,
    screen,
    module,
    role,
    permissions,
  });

  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key === "symbol") continue;
    if (!Object.hasOwn(ALLOWED_CONTEXT_KEYS, key) && !FORBIDDEN_CONTEXT_KEYS.includes(key)) {
      continue;
    }
  }

  return context;
}

export function isHelpAvailable(context) {
  if (!context || typeof context !== "object") return false;
  if (context.platform !== HELP_PLATFORM.WEB && context.platform !== HELP_PLATFORM.MOBILE) return false;
  if (!context.role) return false;
  if (!context.screen) return false;
  return true;
}

function featureAndAction(token) {
  const separator = token.lastIndexOf(":");
  if (separator <= 0) return { feature: token, action: "" };
  return {
    feature: token.slice(0, separator),
    action: token.slice(separator + 1),
  };
}

export function sessionHasPermission(permissions, required) {
  if (typeof required !== "string" || required.trim() === "") return true;
  const held = Array.isArray(permissions) ? permissions : [];
  if (held.includes("ALL_PRIVILEGES")) return true;
  if (held.includes(required)) return true;
  const { feature, action } = featureAndAction(required);
  if (action && held.includes(`${feature}:CRUD`)) return true;
  if (action === "READ" && held.includes(`${feature}:R`)) return true;
  return false;
}

export function articleMatchesContext(article, context) {
  if (!article || !isHelpAvailable(context)) return false;
  if (!article.platforms.includes(context.platform)) return false;
  if (article.roles.length > 0 && !article.roles.includes(context.role)) return false;
  for (const permission of article.permissions) {
    if (!sessionHasPermission(context.permissions, permission)) return false;
  }
  return true;
}

export function navigationIsAllowed(article, context) {
  if (!article?.navigate) return false;
  if (article.navigate.level !== "NAVIGATION") return false;
  if (!articleMatchesContext(article, context)) return false;
  const required = article.navigate.permission;
  if (!required) return false;
  return sessionHasPermission(context.permissions, required);
}
