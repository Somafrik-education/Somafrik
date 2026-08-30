/**
 * Copie publique de la vitrine.
 * Aucune promesse non vérifiée. Aucun jargon ERP / RBAC.
 * Pas de routes légales dans le dépôt : ne pas inventer de liens.
 */

export type MarketingNavLink = {
  href: string;
  label: string;
};

export type MarketingBenefit = {
  title: string;
  description: string;
};

export type MarketingFeatureGroup = {
  title: string;
  items: string[];
};

export type MarketingAudience = {
  title: string;
  description: string;
};

export const marketingNav: MarketingNavLink[] = [
  { href: "#produit", label: "Produit" },
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#web-mobile", label: "Web et mobile" },
  { href: "#securite", label: "Sécurité" },
];

export const marketingLogin = {
  href: "/connexion",
  label: "Connexion",
  ctaLabel: "Se connecter",
} as const;

export const marketingHero = {
  eyebrow: "Gestion scolaire moderne",
  title: "Pilotez votre établissement depuis un seul endroit",
  text:
    "Somafrik réunit les élèves, les enseignants, les présences, les notes, les finances et la communication dans une plateforme accessible sur Web et Mobile.",
  primaryCta: {
    href: "/connexion",
    label: "Se connecter",
  },
  secondaryCta: {
    href: "#produit",
    label: "Voir le produit",
  },
} as const;

export const marketingProduct = {
  id: "produit",
  eyebrow: "Produit",
  title: "Ce que voit la direction une fois connectée",
  text:
    "Somafrik ouvre sur le suivi de l’établissement : classes, élèves, enseignants, puis les outils du quotidien — appels, notes, frais et messages.",
  points: [
    "Annuaire des élèves et organisation des classes",
    "Suivi des enseignants et du travail pédagogique",
    "Tableaux de bord pour lire la situation de l’établissement",
  ],
} as const;

/** Capture runtime réelle — pas d’illustration, pas de maquette. */
export const marketingProductVisual = {
  src: `${import.meta.env.BASE_URL}marketing/somafrik-dashboard-etablissement.webp`,
  alt: "Tableau de bord Somafrik d’un établissement : scolarité, pédagogie, administration et effectifs, avec des données fictives.",
  caption: "Tableau de bord de l’établissement, données fictives.",
  width: 1440,
  height: 900,
} as const;

export const marketingBenefits: MarketingBenefit[] = [
  {
    title: "Centraliser la gestion",
    description:
      "Rassemblez les dossiers, les classes et les comptes de l’établissement au même endroit, à la place des tableurs dispersés.",
  },
  {
    title: "Suivre la scolarité",
    description:
      "Retrouvez les élèves, les inscriptions et le suivi de classe sans multiplier les cahiers et les fichiers.",
  },
  {
    title: "Piloter les finances",
    description:
      "Enregistrez les frais, les encaissements et le reste à payer pour savoir où en sont les familles.",
  },
  {
    title: "Faciliter le travail des équipes",
    description:
      "La direction administre sur le web. Les enseignants font l’appel et saisissent les notes, y compris sur mobile.",
  },
  {
    title: "Rester connecté aux familles",
    description:
      "Les parents suivent notes, présences et frais depuis l’application mobile, selon les accès accordés.",
  },
];

export const marketingFeatures: MarketingFeatureGroup[] = [
  {
    title: "Scolarité",
    items: ["Élèves", "Classes", "Enseignants"],
  },
  {
    title: "Pédagogie",
    items: ["Présences", "Notes", "Évaluations"],
  },
  {
    title: "Finances",
    items: ["Frais scolaires", "Paiements enregistrés", "Suivi des soldes"],
  },
  {
    title: "Communication",
    items: ["Messages", "Annonces"],
  },
  {
    title: "Pilotage",
    items: ["Tableaux de bord", "Indicateurs par établissement"],
  },
];

export const marketingWebMobile = {
  id: "web-mobile",
  eyebrow: "Web et mobile",
  title: "Le bureau pour piloter, le mobile pour le terrain",
  web: {
    title: "Application web",
    text: "Pilotez et administrez votre établissement depuis un écran complet.",
  },
  mobile: {
    title: "Application mobile",
    text: "Retrouvez les opérations du quotidien directement dans l’application Somafrik.",
  },
} as const;

export const marketingMobileVisuals = [
  {
    src: `${import.meta.env.BASE_URL}marketing/mobile/somafrik-mobile-classes.webp`,
    alt: "Application mobile Somafrik — liste des classes",
    caption: "Classes",
    width: 780,
    height: 1688,
  },
  {
    src: `${import.meta.env.BASE_URL}marketing/mobile/somafrik-mobile-eleves.webp`,
    alt: "Application mobile Somafrik — liste des élèves",
    caption: "Élèves",
    width: 780,
    height: 1688,
  },
  {
    src: `${import.meta.env.BASE_URL}marketing/mobile/somafrik-mobile-enseignants.webp`,
    alt: "Application mobile Somafrik — liste des enseignants",
    caption: "Enseignants",
    width: 780,
    height: 1688,
  },
] as const;

export type MarketingBusinessProof = {
  id: string;
  domain: string;
  title: string;
  description: string;
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

export const marketingBusinessProofs = {
  id: "preuves",
  eyebrow: "Preuves métier",
  title: "Somafrik dans le quotidien de l’établissement",
  intro: "Quelques opérations réalisées directement dans l’application.",
  items: [
    {
      id: "finance",
      domain: "Finance",
      title: "Suivre les paiements scolaires",
      description:
        "Consultez les paiements enregistrés et retrouvez les opérations financières de l’établissement.",
      src: `${import.meta.env.BASE_URL}marketing/proofs/somafrik-finance-paiements.webp`,
      alt: "Application mobile Somafrik — liste des paiements",
      caption: "Paiements",
      width: 780,
      height: 1688,
    },
    {
      id: "presences",
      domain: "Présences",
      title: "Faire l’appel depuis le mobile",
      description: "L’enseignant retrouve sa classe et enregistre les présences directement dans l’application.",
      src: `${import.meta.env.BASE_URL}marketing/proofs/somafrik-presences-appel.webp`,
      alt: "Application mobile Somafrik — appel des présences",
      caption: "Appel",
      width: 780,
      height: 1688,
    },
    {
      id: "pedagogie",
      domain: "Pédagogie",
      title: "Organiser les évaluations",
      description: "Retrouvez les évaluations utilisées pour le suivi pédagogique.",
      src: `${import.meta.env.BASE_URL}marketing/proofs/somafrik-evaluations.webp`,
      alt: "Application mobile Somafrik — liste des évaluations",
      caption: "Évaluations",
      width: 780,
      height: 1688,
    },
  ] satisfies readonly MarketingBusinessProof[],
} as const;

export const marketingAudiences: MarketingAudience[] = [
  {
    title: "Direction",
    description: "Voir la situation de l’établissement et décider à partir des dossiers, des présences et des frais.",
  },
  {
    title: "Administration",
    description: "Inscrire les élèves, organiser les classes et tenir les comptes de l’école.",
  },
  {
    title: "Enseignants",
    description: "Faire l’appel et saisir les notes depuis le web ou le mobile.",
  },
  {
    title: "Parents",
    description: "Suivre l’enfant sur mobile : notes, présences et frais.",
  },
];

export const marketingSecurity = {
  id: "securite",
  eyebrow: "Sécurité",
  title: "Chaque établissement reste dans son périmètre",
  items: [
    "Connexion par code établissement et identifiant.",
    "Les données sont séparées par établissement et protégées par des contrôles d’accès.",
    "Des accès adaptés aux responsabilités de chacun.",
  ],
} as const;

export const marketingFinalCta = {
  title: "Accéder à Somafrik",
  text: "Si votre établissement dispose déjà d’un compte, connectez-vous pour ouvrir votre espace.",
  cta: {
    href: "/connexion",
    label: "Se connecter",
  },
} as const;

export const marketingFooter = {
  tagline: "La plateforme qui simplifie la gestion de votre établissement scolaire.",
  copyrightName: "Somafrik",
} as const;

export const marketingSkipLink = {
  href: "#contenu",
  label: "Aller au contenu",
} as const;

/** Routes légales publiques : aucune n’existe aujourd’hui. Ne pas afficher de faux liens. */
export const marketingLegalRoutes: readonly string[] = [];
