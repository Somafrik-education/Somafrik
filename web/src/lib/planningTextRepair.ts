import { normalize } from "./format";

const MOJIBAKE_MARKERS = /[\uFFFD\u00C3\u00E2\u0080\u0099]/;

function planningMatchKey(value: string): string {
  return normalize(value)
    .replace(/\uFFFD/g, "")
    .replace(/(\d+)re\b/g, "$1ere");
}

/** Compare deux libellés (classe ou matière) en tolérant encodage / accents. */
export function planningLabelsMatch(left: string, right: string): boolean {
  return planningMatchKey(left) === planningMatchKey(right);
}

/** Détecte un libellé probablement corrompu (UTF-8 mal interprété). */
export function needsPlanningTextRepair(value: string): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (MOJIBAKE_MARKERS.test(text)) return true;
  if (/(\d+)\s*re\s+[A-Za-z]/i.test(text) && !/(\d+)\s*ère/i.test(text)) return true;
  return false;
}

/** Tente de récupérer du texte UTF-8 lu comme Latin-1. */
export function fixUtf8Mojibake(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return text;

  if (!needsPlanningTextRepair(text)) return text;

  try {
    const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && !MOJIBAKE_MARKERS.test(decoded)) return decoded;
  } catch {
    /* ignore */
  }

  try {
    const legacy = decodeURIComponent(escape(text));
    if (legacy && !MOJIBAKE_MARKERS.test(legacy)) return legacy;
  } catch {
    /* ignore */
  }

  return text
    .replace(/Math\uFFFDmatiques/gi, "Mathématiques")
    .replace(/MathÃ©matiques/gi, "Mathématiques")
    .replace(/Fran\uFFFDais/gi, "Français")
    .replace(/FranÃ§ais/gi, "Français")
    .replace(/G\uFFFDographie/gi, "Géographie")
    .replace(/GÃ©ographie/gi, "Géographie")
    .replace(/1\uFFFDre/gi, "1ère")
    .replace(/1Ã¨re/gi, "1ère")
    .replace(/2\uFFFDme/gi, "2ème")
    .replace(/2Ã¨me/gi, "2ème")
    .replace(/Pr\uFFFDfet/gi, "Préfet")
    .replace(/PrÃ©fet/gi, "Préfet");
}

/** Rapproche un libellé des valeurs canoniques connues (classes, matières). */
export function resolveCanonicalLabel(raw: string, candidates: string[]): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return trimmed;

  const fixed = fixUtf8Mojibake(trimmed);
  if (candidates.includes(fixed)) return fixed;

  const matchKey = planningMatchKey(fixed);
  const exact = candidates.find((candidate) => planningMatchKey(candidate) === matchKey);
  if (exact) return exact;

  const compact = matchKey.replace(/\s+/g, "");
  const compactMatch = candidates.find(
    (candidate) => planningMatchKey(candidate).replace(/\s+/g, "") === compact,
  );
  if (compactMatch) return compactMatch;

  if (/^math.*matiques?$/i.test(matchKey)) {
    const math = candidates.find((candidate) => normalize(candidate).includes("mathematiques"));
    if (math) return math;
  }

  return fixed;
}
