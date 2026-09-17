const showDemoAccounts = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === "true";

const marketplaceEnabled = import.meta.env.VITE_ENABLE_MARKETPLACE === "true";

// Visibilité des CTA Démo sur la vitrine publique. Gardé séparé de l'accès direct /demo.
const publicDemoEnabled = import.meta.env.VITE_ENABLE_PUBLIC_DEMO === "true";

// Permet la recette contrôlée de /demo sans publier les CTA Démo sur la vitrine.
const demoEntryEnabled = import.meta.env.VITE_ENABLE_DEMO_ENTRY === "true" || publicDemoEnabled;

export {
  showDemoAccounts,
  marketplaceEnabled,
  publicDemoEnabled,
  demoEntryEnabled,
};
