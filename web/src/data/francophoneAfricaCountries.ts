/** Pays de qualification de la Démo publique Somafrik (ISO 3166-1 alpha-2). */
export const FRANCOPHONE_AFRICA_COUNTRIES = [
  { iso: "BJ", label: "Bénin" },
  { iso: "BF", label: "Burkina Faso" },
  { iso: "BI", label: "Burundi" },
  { iso: "CM", label: "Cameroun" },
  { iso: "CF", label: "Centrafrique" },
  { iso: "KM", label: "Comores" },
  { iso: "CG", label: "Congo" },
  { iso: "CI", label: "Côte d'Ivoire" },
  { iso: "DJ", label: "Djibouti" },
  { iso: "GA", label: "Gabon" },
  { iso: "GN", label: "Guinée" },
  { iso: "MG", label: "Madagascar" },
  { iso: "ML", label: "Mali" },
  { iso: "MR", label: "Mauritanie" },
  { iso: "NE", label: "Niger" },
  { iso: "CD", label: "RDC" },
  { iso: "RW", label: "Rwanda" },
  { iso: "SN", label: "Sénégal" },
  { iso: "TD", label: "Tchad" },
  { iso: "TG", label: "Togo" },
] as const;

export type FrancophoneAfricaCountryIso =
  (typeof FRANCOPHONE_AFRICA_COUNTRIES)[number]["iso"];
