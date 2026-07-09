/**
 * Contrat accessibilité mobile — lisibilité, contrastes, cibles tactiles, lecteur d'écran.
 */

export const MOBILE_ACCESSIBILITY_COPY = {
  welcomeScreenLabel: "Écran d'accueil Somafrik",
  roleSelectionScreenLabel: "Sélection de l'établissement",
  loginScreenLabel: "Écran de connexion",
} as const;

/** Cible tactile minimale recommandée (WCAG 2.5.5 / Material). */
export const MIN_TOUCH_TARGET = 48;

/** Taille minimale du texte courant (px). */
export const MIN_BODY_FONT_SIZE = 12;

/** Taille minimale des titres principaux (px). */
export const MIN_TITLE_FONT_SIZE = 14;

/** Contraste minimum texte normal (WCAG AA). */
export const MIN_CONTRAST_NORMAL = 4.5;

/** Contraste minimum grands textes / UI (WCAG AA). */
export const MIN_CONTRAST_LARGE = 3;

export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const transform = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

export function parseCssColor(value: string): [number, number, number] | null {
  const raw = String(value ?? "").trim();
  const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  if (raw.startsWith("#") && (raw.length === 7 || raw.length === 4)) {
    const hex =
      raw.length === 4
        ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
        : raw;
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return null;
}

export function contrastBetweenColors(foreground: string, background: string): number | null {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg[0], fg[1], fg[2]);
  const l2 = relativeLuminance(bg[0], bg[1], bg[2]);
  return contrastRatio(l1, l2);
}
