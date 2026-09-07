/**
 * Pays du formulaire public `/demande-essai`.
 *
 * Périmètre : Afrique francophone commerciale Somafrik (ISO 3166-1 alpha-2),
 * pas le référentiel PostgreSQL `countries` (démo CD/CG/BI) et pas le Mobile.
 *
 * Inclus — français langue officielle ou d’enseignement largement utilisée :
 * Bénin, Burkina Faso, Burundi (kirundi + français), Cameroun (FR/EN, offre FR),
 * Centrafrique, Comores (comorien/arabe/français), Congo-Brazzaville, Côte d’Ivoire,
 * Djibouti (français + arabe), Gabon, Guinée, Madagascar (malgache + français),
 * Mali, Mauritanie (arabe officiel, français courant dans l’enseignement),
 * Niger, RDC, Rwanda (kinyarwanda/anglais/français — retenu pour l’offre FR),
 * Sénégal, Tchad (français + arabe), Togo.
 *
 * Exclus volontairement (pas un oubli) :
 * - SC Seychelles, MU Maurice : français officiel ou créole, mais l’anglais
 *   domine le canal commercial visé ;
 * - GQ Guinée équatoriale : espagnol langue principale ;
 * - DZ Algérie, MA Maroc, TN Tunisie : Maghreb, hors mandat commercial actuel ;
 * - GW Guinée-Bissau, CV Cap-Vert : lusophones.
 */
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
