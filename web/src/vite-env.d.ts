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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
