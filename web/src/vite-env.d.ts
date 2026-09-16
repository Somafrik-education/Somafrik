/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origine backend obligatoire (ex. https://api.somafrik.app). */
  readonly VITE_API_URL: string;
  /** Chemin de base Vite (ex. / ou /web/). */
  readonly VITE_BASE_PATH?: string;
  /** Proxy dev uniquement — cible Express locale. */
  readonly VITE_API_TARGET?: string;
  readonly VITE_SHOW_DEMO_ACCOUNTS?: string;
  readonly VITE_ENABLE_MARKETPLACE?: string;
  /** Affiche les CTA Démo sur la vitrine publique. */
  readonly VITE_ENABLE_PUBLIC_DEMO?: string;
  /** Active uniquement la page directe /demo pour recette contrôlée. */
  readonly VITE_ENABLE_DEMO_ENTRY?: string;
  /** API publique de création de session Démo. */
  readonly VITE_DEMO_ENTRY_API_URL?: string;
  /** Origine Web autorisée pour la redirection Démo. */
  readonly VITE_DEMO_WEB_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
