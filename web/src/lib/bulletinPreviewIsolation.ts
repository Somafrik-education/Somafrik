/**
 * SEC-XSS-01 — isolation de l'aperçu HTML des modèles de bulletin.
 *
 * Le HTML/CSS d'un modèle peut être écrit par un compte établissement : il est
 * traité comme non fiable. L'aperçu est rendu dans une iframe `sandbox` vide :
 * origine opaque (aucun accès aux cookies, localStorage, sessionStorage ni à la
 * fenêtre parente), aucun script, aucun formulaire, aucune fenêtre ni
 * navigation de la page principale. La CSP ci-dessous coupe en plus tout
 * chargement réseau : seules les ressources incorporées en `data:` s'affichent.
 */

/** Valeur exacte de l'attribut `sandbox` : aucune permission. */
export const BULLETIN_PREVIEW_SANDBOX = "";

export const BULLETIN_PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Au-delà, l'aperçu est refusé (le Backend plafonne déjà le modèle). */
export const MAX_BULLETIN_PREVIEW_CHARS = 16 * 1024 * 1024;

export class BulletinPreviewError extends Error {
  constructor(message = "Aperçu du bulletin indisponible.") {
    super(message);
    this.name = "BulletinPreviewError";
  }
}

/**
 * Document `srcdoc` de l'aperçu : la CSP est placée avant tout contenu du
 * modèle, donc appliquée avant le moindre chargement. Une meta CSP ne peut
 * qu'ajouter des restrictions : le modèle ne peut pas l'assouplir.
 */
export function buildIsolatedPreviewDocument(html: unknown): string {
  if (typeof html !== "string" || !html.trim() || html.length > MAX_BULLETIN_PREVIEW_CHARS) {
    throw new BulletinPreviewError();
  }
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${BULLETIN_PREVIEW_CSP}">`;
  const referrerMeta = `<meta name="referrer" content="no-referrer">`;
  return `<!DOCTYPE html><html><head>${cspMeta}${referrerMeta}</head><body>${html}</body></html>`;
}

// --- Projet GrapesJS enregistré ----------------------------------------------

const BLOCKED_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "meta",
  "link",
  "portal",
  "form",
]);
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "xlink:href",
  "data",
  "poster",
  "background",
  "lowsrc",
  "ping",
]);
const BLOCKED_ATTRIBUTES = new Set(["srcdoc"]);
const BLOCKED_COMPONENT_KEYS = new Set(["script", "script-export", "script-props"]);

function isUnsafeUrl(value: unknown): boolean {
  // Espaces et caractères de contrôle ignorés, comme le fait le navigateur.
  // eslint-disable-next-line no-control-regex
  const compact = String(value ?? "").replace(/[\u0000- \u007f]+/g, "").toLowerCase();
  return compact.startsWith("javascript:") || compact.startsWith("vbscript:") || compact.startsWith("data:text/html");
}

function sanitizeAttributes(attributes: unknown): Record<string, unknown> | undefined {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [rawName, value] of Object.entries(attributes as Record<string, unknown>)) {
    const name = rawName.trim().toLowerCase();
    if (!name || name.startsWith("on") || BLOCKED_ATTRIBUTES.has(name)) continue;
    if (URL_ATTRIBUTES.has(name) && isUnsafeUrl(value)) continue;
    safe[rawName] = value;
  }
  return safe;
}

/** Profondeur maximale acceptée ; au-delà, la branche est abandonnée. */
export const MAX_GRAPES_PROJECT_DEPTH = 64;

/**
 * `ancestors` ne contient que les objets du chemin en cours : une référence
 * partagée légitime (même objet à deux endroits) est conservée, seul un vrai
 * cycle (objet qui se contient lui-même) est coupé.
 */
function sanitizeComponent(component: unknown, depth: number, ancestors: Set<object>): unknown {
  if (component === null || typeof component !== "object") {
    return typeof component === "function" || typeof component === "symbol" ? undefined : component;
  }
  if (depth > MAX_GRAPES_PROJECT_DEPTH || ancestors.has(component)) return null;
  ancestors.add(component);
  try {
    if (Array.isArray(component)) {
      return component
        .map((entry) => sanitizeComponent(entry, depth + 1, ancestors))
        .filter((entry) => entry !== null && entry !== undefined);
    }

    const source = component as Record<string, unknown>;
    const tag = String(source.tagName ?? "").trim().toLowerCase();
    const type = String(source.type ?? "").trim().toLowerCase();
    if (BLOCKED_TAGS.has(tag) || BLOCKED_TAGS.has(type)) return null;

    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (BLOCKED_COMPONENT_KEYS.has(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (key === "attributes") {
        const attributes = sanitizeAttributes(value);
        if (attributes) safe.attributes = attributes;
        continue;
      }
      if (key === "components") {
        safe.components = typeof value === "string" ? "" : sanitizeComponent(value, depth + 1, ancestors);
        continue;
      }
      if (key === "content" && typeof value === "string" && /[<>]/.test(value)) {
        // Le contenu brut n'est jamais réinterprété comme du HTML.
        safe.content = value.replace(/[<>]/g, "");
        continue;
      }
      const next = sanitizeComponent(value, depth + 1, ancestors);
      if (next !== undefined) safe[key] = next;
    }
    return safe;
  } finally {
    ancestors.delete(component);
  }
}

/**
 * Projet GrapesJS relu depuis la base : `loadProjectData` restitue les
 * attributs tels quels, sans passer par l'analyseur HTML. On retire donc les
 * gestionnaires `on*`, les URL `javascript:`, `srcdoc` et les balises actives
 * avant chargement. Les styles et la mise en page sont conservés.
 */
export function sanitizeGrapesProjectData(project: unknown): Record<string, unknown> | null {
  if (!project || typeof project !== "object" || Array.isArray(project)) return null;
  const safe = sanitizeComponent(project, 0, new Set());
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : null;
}

/** Options de l'analyseur HTML GrapesJS, figées (pas de script, pas d'attribut actif). */
export const GRAPES_SAFE_PARSER_OPTIONS = Object.freeze({
  allowScripts: false,
  allowUnsafeAttr: false,
  allowUnsafeAttrValue: false,
});

/**
 * Document initial du canevas de l'éditeur : aucun script du modèle ne s'y
 * exécute (les gestionnaires `on*` et `javascript:` sont bloqués par la CSP).
 * GrapesJS pilote le canevas depuis la page parente, sans script interne.
 */
export const GRAPES_CANVAS_CSP = [
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const GRAPES_CANVAS_FRAME_CONTENT = `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${GRAPES_CANVAS_CSP}">`;
