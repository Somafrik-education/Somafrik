import { useEffect, useState } from "react";
import interLatin500 from "@fontsource/inter/files/inter-latin-500-normal.woff2?url";
import interLatin600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import interLatin700 from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";
import interLatin800 from "@fontsource/inter/files/inter-latin-800-normal.woff2?url";
import interLatinExt500 from "@fontsource/inter/files/inter-latin-ext-500-normal.woff2?url";
import interLatinExt600 from "@fontsource/inter/files/inter-latin-ext-600-normal.woff2?url";
import interLatinExt700 from "@fontsource/inter/files/inter-latin-ext-700-normal.woff2?url";
import interLatinExt800 from "@fontsource/inter/files/inter-latin-ext-800-normal.woff2?url";

/**
 * CARTE-UI-01 — typographie de la carte réellement chargée (Inter, licence OFL-1.1, fichiers
 * locaux servis par l'application : aucun CDN). Famille dédiée à la carte : la police du reste de
 * l'interface n'est pas modifiée.
 */
export const STUDENT_CARD_FONT_FAMILY = "Somafrik Card Inter";

const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT_RANGE =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const FACES: ReadonlyArray<{ weight: string; src: string; unicodeRange: string }> = [
  { weight: "500", src: interLatin500, unicodeRange: LATIN_RANGE },
  { weight: "600", src: interLatin600, unicodeRange: LATIN_RANGE },
  { weight: "700", src: interLatin700, unicodeRange: LATIN_RANGE },
  { weight: "800", src: interLatin800, unicodeRange: LATIN_RANGE },
  { weight: "500", src: interLatinExt500, unicodeRange: LATIN_EXT_RANGE },
  { weight: "600", src: interLatinExt600, unicodeRange: LATIN_EXT_RANGE },
  { weight: "700", src: interLatinExt700, unicodeRange: LATIN_EXT_RANGE },
  { weight: "800", src: interLatinExt800, unicodeRange: LATIN_EXT_RANGE },
];

/** Délai maximal d'attente : au-delà, l'impression reste possible avec la police de secours. */
export const STUDENT_CARD_FONT_TIMEOUT_MS = 4000;

export type StudentCardFontState = "loading" | "loaded" | "fallback";

let pending: Promise<StudentCardFontState> | null = null;

function fontApiAvailable(): boolean {
  return typeof document !== "undefined" && typeof FontFace === "function" && Boolean(document.fonts);
}

/** Charge une seule fois les 8 fichiers (latin + latin étendu, graisses 500 à 800). */
export function loadStudentCardFonts(): Promise<StudentCardFontState> {
  if (!fontApiAvailable()) return Promise.resolve("fallback");
  if (pending) return pending;
  const load = Promise.all(
    FACES.map(async ({ weight, src, unicodeRange }) => {
      const face = new FontFace(STUDENT_CARD_FONT_FAMILY, `url(${src}) format("woff2")`, {
        weight,
        style: "normal",
        display: "block",
        unicodeRange,
      });
      document.fonts.add(face);
      await face.load();
    }),
  ).then(
    () => "loaded" as const,
    () => "fallback" as const,
  );
  const timeout = new Promise<StudentCardFontState>((resolve) => {
    setTimeout(() => resolve("fallback"), STUDENT_CARD_FONT_TIMEOUT_MS);
  });
  pending = Promise.race([load, timeout]).then((state) => {
    if (state === "fallback") pending = null;
    return state;
  });
  return pending;
}

export function useStudentCardFonts(): StudentCardFontState {
  const [state, setState] = useState<StudentCardFontState>("loading");
  useEffect(() => {
    let cancelled = false;
    void loadStudentCardFonts().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
