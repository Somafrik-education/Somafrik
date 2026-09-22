export const marketingDemo = {
  href: "/demo",
  label: "Démo",
  ctaLabel: "Découvrir Somafrik en démo",
} as const;

export const demoProfiles = [
  { value: "direction", label: "Direction / Promoteur" },
  { value: "administration", label: "Administration scolaire" },
  { value: "enseignant", label: "Enseignant" },
  { value: "personnel", label: "Personnel" },
  { value: "parent", label: "Parent" },
  { value: "partenaire", label: "Partenaire / ONG" },
  { value: "investisseur", label: "Investisseur" },
  { value: "etudiant", label: "Étudiant / Chercheur" },
  { value: "autre", label: "Autre" },
] as const;

export const demoDiscoveryRoles = [
  { value: "decider", label: "Je décide" },
  { value: "choix", label: "Je participe au choix" },
  { value: "utilisateur", label: "Je serai utilisateur" },
  { value: "recommande", label: "Je recommande des solutions" },
  { value: "decouverte", label: "Je découvre simplement" },
] as const;

export const demoPageCopy = {
  eyebrow: "Démonstration interactive",
  title: "Découvrir Somafrik",
  intro:
    "Indiquez simplement votre profil. Vous entrerez ensuite dans un environnement Somafrik séparé, contenant uniquement des données fictives.",
  privacy:
    "Aucun e-mail ni numéro de téléphone n’est requis pour accéder à la démonstration.",
  disabled:
    "La démonstration publique est en cours de préparation. Vous pouvez demander un mois d’essai gratuit pendant ce temps.",
} as const;
