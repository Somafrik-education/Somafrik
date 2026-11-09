/**
 * CARTE-BATCH-DESIGN-01 — référence de design unique de la carte élève.
 *
 * Maquette P1 « Bandeau institutionnel » (CARTE-UI-01, chantier #979), CR80 paysage.
 * Ces valeurs alimentent les trois rendus :
 *  - la carte individuelle (StudentCardFace, CSS produit par studentCardFaceCss) ;
 *  - le document HTML CR80 par classe (même composant, même CSS) ;
 *  - le PDF A4 (studentCardBatchPdf dessine avec ces mêmes cotes).
 * Aucune valeur de mise en page ne doit être recopiée ailleurs.
 *
 * Ce module ne manipule aucun jeton et ne contacte aucun serveur.
 */

export const STUDENT_CARD_P1 = Object.freeze({
  widthMm: 85.6,
  heightMm: 53.98,
  colors: Object.freeze({
    navy: "#13285e",
    brand: "#1d4ed8",
    ink: "#0f172a",
    muted: "#475569",
    line: "#dbe3ee",
    tint: "#eef3fb",
    paper: "#ffffff",
  }),
  radiusMm: 3.18,
  outlineMm: 0.25,
  band: Object.freeze({
    heightMm: 13,
    longHeightMm: 14,
    padXMm: 3,
    slotWidthMm: 9,
    slotHeightMm: 8,
    logoDiameterMm: 8,
    logoImageMm: 6.6,
    textGapMm: 0.7,
    longTextGapMm: 0.5,
    holderSizeMm: 4,
    longHolderSizeMm: 3.6,
    holderTrackingEm: 0.08,
    schoolSizeMm: Object.freeze({ l1: 2.4, l2: 2.3 }),
    schoolLineHeight: Object.freeze({ l1: 1.1, l2: 1.05 }),
    schoolOpacity: 0.94,
  }),
  body: Object.freeze({
    topMm: 15.5,
    longTopMm: 16.3,
    leftMm: 3.5,
    rightMm: 3.5,
    bottomMm: 8,
    gapMm: 3,
  }),
  photo: Object.freeze({
    widthMm: 20,
    heightMm: 25.7,
    radiusMm: 1.2,
    initialsSizeMm: 7,
    initialsTrackingEm: 0.02,
  }),
  info: Object.freeze({
    gapMm: 1.2,
    nameLineHeight: 1.12,
    nameSizeMm: Object.freeze({ l1: 3.7, l2: 3.05, l3: 2.7, l4: 2.35 }),
    captionSizeMm: 2.3,
    captionLineHeight: 1.15,
    captionTrackingEm: 0.06,
    valueLineHeight: 1.2,
    valueSizeMm: Object.freeze({ l1: 2.65, l2: 2.35 }),
    numberTrackingEm: 0.02,
  }),
  qr: Object.freeze({ sizeMm: 23 }),
  foot: Object.freeze({
    heightMm: 6.8,
    padXMm: 3.5,
    gapMm: 2,
    borderMm: 0.6,
    textSizeMm: 2.3,
    brandTrackingEm: 0.04,
  }),
  /** Seuils de passage à la taille inférieure (nombre de caractères). */
  thresholds: Object.freeze({
    /** Nom : paliers l1 ≤ 22, l2 ≤ 34, l3 ≤ 48 caractères, l4 au-delà. */
    name: Object.freeze([22, 34, 48] as const),
    schoolName: 38,
    classLabel: 40,
    studentCode: 16,
  }),
  /** Libellés fixes imprimés sur la carte. */
  labels: Object.freeze({
    matricule: "Matricule",
    cardRef: "Réf. carte",
    brand: "Somafrik",
    qrAlt: "QR de la carte",
  }),
});

export const STUDENT_CARD_FONT_STACK =
  '"Somafrik Card Inter", "Inter", ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif';

/** Métriques verticales d'Inter (unités em), pour placer les lignes du PDF comme le navigateur. */
export const STUDENT_CARD_INTER_METRICS = Object.freeze({ ascent: 0.96875, descent: 0.2421875, capHeight: 0.727 });

export type StudentCardNameStep = "l1" | "l2" | "l3" | "l4";

/** Palier du nom : le texte n'est jamais tronqué, il diminue puis passe à la ligne (≥ 6,5 pt). */
export function studentCardNameStepOf(displayName: string): StudentCardNameStep {
  const length = Array.from(String(displayName ?? "").trim()).length;
  const [l1, l2, l3] = STUDENT_CARD_P1.thresholds.name;
  if (length <= l1) return "l1";
  if (length <= l2) return "l2";
  if (length <= l3) return "l3";
  return "l4";
}

export function studentCardNameSizeMm(displayName: string): number {
  return STUDENT_CARD_P1.info.nameSizeMm[studentCardNameStepOf(displayName)];
}

const mm = (value: number) => `${value}mm`;

/**
 * CSS du recto, produit depuis STUDENT_CARD_P1. Injecté dans l'application par StudentCardFace
 * et recopié tel quel dans le document HTML CR80 par classe.
 */
export function studentCardFaceCss(): string {
  const d = STUDENT_CARD_P1;
  const c = d.colors;
  return `
/*
 * CARTE-UI-01 — recto de la carte (maquette P1 « Bandeau institutionnel »), en millimètres réels.
 * Couleurs figées : objet imprimé, indépendant du thème de l'interface. Texte ≥ 6,5 pt (2,3 mm).
 * Marges de sécurité du texte : ≥ 3 mm à gauche et à droite, ≥ 2 mm en haut et en bas.
 */
.student-card-face {
  --scf-navy: ${c.navy};
  --scf-brand: ${c.brand};
  --scf-ink: ${c.ink};
  --scf-muted: ${c.muted};
  --scf-line: ${c.line};
  --scf-tint: ${c.tint};
  position: relative;
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  border-radius: ${mm(d.radiusMm)};
  background: ${c.paper};
  color: var(--scf-ink);
  font-family: ${STUDENT_CARD_FONT_STACK};
  font-kerning: normal;
  box-shadow: 0 0 0 ${mm(d.outlineMm)} var(--scf-line);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.student-card-face * {
  box-sizing: border-box;
  margin: 0;
}

.student-card-face .scf-band {
  position: absolute;
  inset: 0 0 auto 0;
  height: ${mm(d.band.heightMm)};
  display: grid;
  grid-template-columns: ${mm(d.band.slotWidthMm)} minmax(0, 1fr) ${mm(d.band.slotWidthMm)};
  align-items: center;
  padding: 0 ${mm(d.band.padXMm)};
  background: var(--scf-navy);
  color: ${c.paper};
}

.student-card-face .scf-logo-slot {
  width: ${mm(d.band.slotWidthMm)};
  height: ${mm(d.band.slotHeightMm)};
  display: flex;
  align-items: center;
}

.student-card-face .scf-logo {
  width: ${mm(d.band.logoDiameterMm)};
  height: ${mm(d.band.logoDiameterMm)};
  border-radius: 50%;
  background: ${c.paper};
  display: grid;
  place-items: center;
  overflow: hidden;
}

.student-card-face .scf-logo img {
  width: ${mm(d.band.logoImageMm)};
  height: ${mm(d.band.logoImageMm)};
  object-fit: contain;
}

.student-card-face .scf-band-text {
  display: grid;
  gap: ${mm(d.band.textGapMm)};
  min-width: 0;
  text-align: center;
}

.student-card-face .scf-holder {
  font-size: ${mm(d.band.holderSizeMm)};
  font-weight: 800;
  line-height: 1;
  letter-spacing: ${d.band.holderTrackingEm}em;
  text-transform: uppercase;
  white-space: nowrap;
}

.student-card-face .scf-school {
  font-weight: 500;
  line-height: ${d.band.schoolLineHeight.l1};
  overflow-wrap: anywhere;
  opacity: ${d.band.schoolOpacity};
}

.student-card-face .scf-school-l1 { font-size: ${mm(d.band.schoolSizeMm.l1)}; }
.student-card-face .scf-school-l2 { font-size: ${mm(d.band.schoolSizeMm.l2)}; line-height: ${d.band.schoolLineHeight.l2}; }

/* Nom d'établissement sur deux lignes : bandeau de 14 mm pour garder ≥ 2 mm de marge en haut. */
.student-card-face.scf-long-school .scf-band { height: ${mm(d.band.longHeightMm)}; }
.student-card-face.scf-long-school .scf-holder { font-size: ${mm(d.band.longHolderSizeMm)}; }
.student-card-face.scf-long-school .scf-band-text { gap: ${mm(d.band.longTextGapMm)}; }
.student-card-face.scf-long-school .scf-body { top: ${mm(d.body.longTopMm)}; }

.student-card-face .scf-body {
  position: absolute;
  top: ${mm(d.body.topMm)};
  left: ${mm(d.body.leftMm)};
  right: ${mm(d.body.rightMm)};
  bottom: ${mm(d.body.bottomMm)};
  display: flex;
  align-items: flex-start;
  gap: ${mm(d.body.gapMm)};
}

.student-card-face .scf-photo {
  flex: none;
  width: ${mm(d.photo.widthMm)};
  height: ${mm(d.photo.heightMm)};
  border-radius: ${mm(d.photo.radiusMm)};
  overflow: hidden;
  background: var(--scf-tint);
  display: grid;
  place-items: center;
}

.student-card-face .scf-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.student-card-face .scf-initials {
  font-size: ${mm(d.photo.initialsSizeMm)};
  font-weight: 800;
  color: var(--scf-navy);
  letter-spacing: ${d.photo.initialsTrackingEm}em;
}

.student-card-face .scf-info {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  align-content: start;
  gap: ${mm(d.info.gapMm)};
}

.student-card-face .scf-name {
  font-weight: 800;
  line-height: ${d.info.nameLineHeight};
  overflow-wrap: anywhere;
  hyphens: none;
}

/* Nom toujours intégral : la taille diminue par paliers puis le texte passe à la ligne. */
.student-card-face .scf-name-l1 { font-size: ${mm(d.info.nameSizeMm.l1)}; }
.student-card-face .scf-name-l2 { font-size: ${mm(d.info.nameSizeMm.l2)}; }
.student-card-face .scf-name-l3 { font-size: ${mm(d.info.nameSizeMm.l3)}; }
.student-card-face .scf-name-l4 { font-size: ${mm(d.info.nameSizeMm.l4)}; }

.student-card-face .scf-caption {
  font-size: ${mm(d.info.captionSizeMm)};
  font-weight: 700;
  line-height: ${d.info.captionLineHeight};
  letter-spacing: ${d.info.captionTrackingEm}em;
  text-transform: uppercase;
  color: var(--scf-muted);
}

.student-card-face .scf-value {
  font-weight: 600;
  line-height: ${d.info.valueLineHeight};
  overflow-wrap: anywhere;
}

.student-card-face .scf-value-l1 { font-size: ${mm(d.info.valueSizeMm.l1)}; }
.student-card-face .scf-value-l2 { font-size: ${mm(d.info.valueSizeMm.l2)}; }

.student-card-face .scf-number {
  font-variant-numeric: tabular-nums;
  letter-spacing: ${d.info.numberTrackingEm}em;
}

/* QR : 23 mm au total, zone de silence de 4 modules incluse dans l'image (≈ 19 mm de modules). */
.student-card-face .scf-qr {
  flex: none;
  width: ${mm(d.qr.sizeMm)};
  height: ${mm(d.qr.sizeMm)};
  background: ${c.paper};
  display: grid;
  place-items: center;
  line-height: 0;
}

.student-card-face .scf-qr img {
  width: ${mm(d.qr.sizeMm)};
  height: ${mm(d.qr.sizeMm)};
  image-rendering: pixelated;
}

.student-card-face .scf-qr-status {
  font-size: ${mm(d.foot.textSizeMm)};
  line-height: 1.2;
  text-align: center;
  color: var(--scf-muted);
}

.student-card-face .scf-foot {
  position: absolute;
  inset: auto 0 0 0;
  height: ${mm(d.foot.heightMm)};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${mm(d.foot.gapMm)};
  padding: 0 ${mm(d.foot.padXMm)};
  border-top: ${mm(d.foot.borderMm)} solid var(--scf-brand);
  background: var(--scf-tint);
  font-size: ${mm(d.foot.textSizeMm)};
  line-height: 1;
  color: var(--scf-muted);
}

.student-card-face .scf-brand {
  font-weight: 600;
  letter-spacing: ${d.foot.brandTrackingEm}em;
}
`;
}

/* ------------------------------------------------------------------------------------------ */
/* Feuille A4 portrait (HTML CR80 par classe et PDF A4) : même grille, mêmes repères de découpe. */
/* ------------------------------------------------------------------------------------------ */

export const CARD_SHEET = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: STUDENT_CARD_P1.widthMm,
  cardHeightMm: STUDENT_CARD_P1.heightMm,
  columns: 2 as const,
  markMm: 1.5,
  offsetMm: 0.35,
  minMarginMm: 5,
} as const;

export const CARD_SHEET_GUTTER_MM = 2 * (CARD_SHEET.offsetMm + CARD_SHEET.markMm);

export interface CardSheetLayout {
  columns: 2;
  rows: 4 | 5;
  cardsPerPage: 8 | 10;
  gutterMm: number;
  marginXMm: number;
  marginYMm: number;
  markMm: number;
  offsetMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

export interface CutMarkSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function measureSheet(rows: 4 | 5, minMarginMm: number): CardSheetLayout | null {
  const { columns, cardWidthMm, cardHeightMm, pageWidthMm, pageHeightMm, markMm, offsetMm } = CARD_SHEET;
  const gutterMm = CARD_SHEET_GUTTER_MM;
  const gridWidth = columns * cardWidthMm + (columns - 1) * gutterMm;
  const gridHeight = rows * cardHeightMm + (rows - 1) * gutterMm;
  const marginXMm = (pageWidthMm - gridWidth) / 2;
  const marginYMm = (pageHeightMm - gridHeight) / 2;
  if (marginXMm < minMarginMm || marginYMm < minMarginMm) return null;
  return {
    columns,
    rows,
    cardsPerPage: rows === 5 ? 10 : 8,
    gutterMm,
    marginXMm,
    marginYMm,
    markMm,
    offsetMm,
    cardWidthMm,
    cardHeightMm,
    pageWidthMm,
    pageHeightMm,
  };
}

export function chooseCardSheetLayout(limits: { minMarginMm?: number } = {}): CardSheetLayout | null {
  const minMarginMm = limits.minMarginMm ?? CARD_SHEET.minMarginMm;
  return measureSheet(5, minMarginMm) ?? measureSheet(4, minMarginMm);
}

/** Position d'une carte sur la page, origine en bas à gauche (repère PDF). */
export function cardRectMm(layout: CardSheetLayout, slot: number): { x: number; y: number; width: number; height: number } {
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  return {
    x: layout.marginXMm + column * (layout.cardWidthMm + layout.gutterMm),
    y:
      layout.pageHeightMm -
      layout.marginYMm -
      (row + 1) * layout.cardHeightMm -
      row * layout.gutterMm,
    width: layout.cardWidthMm,
    height: layout.cardHeightMm,
  };
}

export function cardCutMarkSegments(
  x: number,
  y: number,
  width: number,
  height: number,
  offset: number,
  mark: number,
): CutMarkSegment[] {
  return [
    { x1: x - offset - mark, y1: y, x2: x - offset, y2: y },
    { x1: x, y1: y - offset - mark, x2: x, y2: y - offset },
    { x1: x + width + offset, y1: y, x2: x + width + offset + mark, y2: y },
    { x1: x + width, y1: y - offset - mark, x2: x + width, y2: y - offset },
    { x1: x - offset - mark, y1: y + height, x2: x - offset, y2: y + height },
    { x1: x, y1: y + height + offset, x2: x, y2: y + height + offset + mark },
    { x1: x + width + offset, y1: y + height, x2: x + width + offset + mark, y2: y + height },
    { x1: x + width, y1: y + height + offset, x2: x + width, y2: y + height + offset + mark },
  ];
}

export const CARD_CUT_MARK_COLOR = "#737373";
export const CARD_CUT_MARK_WIDTH_PT = 0.4;

/* ------------------------------------------------------------------------------------------ */
/* Éléments visuels transportés par le document source (logo de l'établissement, photo).       */
/* ------------------------------------------------------------------------------------------ */

/**
 * - embedded : image intégrée au document (data URL PNG ou JPEG) ;
 * - absent : l'établissement n'a pas de logo / l'élève n'a pas de photo ;
 * - unavailable : l'image existe mais n'a pas pu être intégrée lors de la production ;
 * - not_in_source : document antérieur (v1) qui ne transportait pas cet élément.
 * Seul « embedded » affiche une image. Sinon : initiales pour la photo, emplacement vide pour
 * le logo. Aucune image n'est jamais inventée ni recherchée après coup.
 */
export type CardVisual =
  | { state: "embedded"; src: string }
  | { state: "absent" }
  | { state: "unavailable" }
  | { state: "not_in_source" };

export type CardVisualState = CardVisual["state"];

/** Pixels produits à l'intégration : environ 250 ppp à la taille imprimée. */
export const CARD_PHOTO_PIXELS = Object.freeze({ width: 200, height: 257 });
export const CARD_LOGO_PIXELS = 160;
export const CARD_VISUAL_MAX_BYTES = 200_000;

const VISUAL_DATA_URL_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export function cardVisualSrc(visual: CardVisual | null | undefined): string | null {
  return visual?.state === "embedded" ? visual.src : null;
}

/** Décode une data URL PNG/JPEG intégrée et vérifie la signature du fichier. */
export function decodeCardVisualDataUrl(src: string): { type: "png" | "jpeg"; bytes: Uint8Array } | null {
  if (typeof src !== "string" || src.length > Math.ceil(CARD_VISUAL_MAX_BYTES / 3) * 4 + 32) return null;
  const match = VISUAL_DATA_URL_RE.exec(src);
  if (!match) return null;
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  if (binary.length < 16 || binary.length > CARD_VISUAL_MAX_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const type = match[1] as "png" | "jpeg";
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((type === "png" && !png) || (type === "jpeg" && !jpeg)) return null;
  return { type, bytes };
}

/** Relit un élément visuel du document source ; undefined = valeur altérée (document refusé). */
export function readCardVisual(value: unknown): CardVisual | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (state === "absent" || state === "unavailable" || state === "not_in_source") {
    return Object.keys(record).length === 1 ? { state } : undefined;
  }
  if (state === "embedded" && typeof record.src === "string" && Object.keys(record).length === 2) {
    return decodeCardVisualDataUrl(record.src) ? { state, src: record.src } : undefined;
  }
  return undefined;
}

export interface CardVisualReport {
  logo: CardVisualState;
  photos: Record<CardVisualState, number>;
}

export function cardVisualReport(logo: CardVisual, photos: readonly CardVisual[]): CardVisualReport {
  const counts: Record<CardVisualState, number> = { embedded: 0, absent: 0, unavailable: 0, not_in_source: 0 };
  for (const photo of photos) counts[photo.state] += 1;
  return { logo: logo.state, photos: counts };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** Phrase lisible pour l'opérateur : ce qui est imprimé, ce qui manque, sans réémission. */
export function cardVisualReportMessage(report: CardVisualReport): string | null {
  const { photos } = report;
  if (report.logo === "not_in_source" || photos.not_in_source > 0) {
    return "Ce document CR80 a été produit avant l’intégration du logo et des photos. Les cartes sont imprimées sans logo, avec les initiales à la place de la photo. Aucune carte n’est réémise ni remplacée.";
  }
  const parts: string[] = [];
  if (report.logo === "absent") parts.push("aucun logo d’établissement enregistré : emplacement laissé vide");
  if (report.logo === "unavailable") parts.push("logo de l’établissement non intégré : emplacement laissé vide");
  if (photos.absent > 0) parts.push(`${plural(photos.absent, "élève sans photo", "élèves sans photo")} : initiales imprimées`);
  if (photos.unavailable > 0) {
    parts.push(`${plural(photos.unavailable, "photo non intégrée", "photos non intégrées")} : initiales imprimées`);
  }
  if (parts.length === 0) return null;
  return `Éléments visuels manquants — ${parts.join(" ; ")}.`;
}
