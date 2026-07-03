/** Palette Somafrik pour Recharts (alignée Tailwind brand / teal). */
export const CHART_COLORS = {
  brand: "#1d4ed8",
  brandLight: "#3b82f6",
  teal: "#0f766e",
  emerald: "#059669",
  amber: "#d97706",
  rose: "#e11d48",
  slate: "#64748b",
  violet: "#7c3aed",
} as const;

export const CHART_PALETTE = [
  CHART_COLORS.brand,
  CHART_COLORS.teal,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.brandLight,
  CHART_COLORS.slate,
];

export const CHART_AXIS = {
  tick: { fill: "#64748b", fontSize: 12, fontWeight: 600 },
  grid: "#e2e8f0",
};

export const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 10px 30px -20px rgba(15,23,42,0.35)",
  fontSize: 13,
  fontWeight: 600,
};
