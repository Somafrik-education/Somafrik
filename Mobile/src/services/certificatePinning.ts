/**
 * S2.3 — Hook d'architecture pour le certificate pinning (implémentation future).
 * Aucun appel réseau ne doit contourner ce point d'extension.
 */

export type CertificatePinningConfig = {
  enabled: boolean;
  /** Domaines pour lesquels le pinning sera activé plus tard. */
  hosts: string[];
};

let pinningConfig: CertificatePinningConfig = {
  enabled: false,
  hosts: [],
};

/** Prépare la config de pinning sans l'activer (S2.3). */
export function configureCertificatePinning(config: Partial<CertificatePinningConfig>) {
  pinningConfig = {
    ...pinningConfig,
    ...config,
    hosts: config.hosts ?? pinningConfig.hosts,
  };
}

export function getCertificatePinningConfig(): CertificatePinningConfig {
  return { ...pinningConfig, hosts: [...pinningConfig.hosts] };
}

/**
 * Point d'extension avant chaque requête HTTPS.
 * Aujourd'hui : no-op validant que l'URL est bien https en production.
 * Demain : brancher le module natif de pinning.
 */
export function assertTransportSecurity(url: string, { allowInsecureDev = false } = {}) {
  const normalized = String(url ?? "").trim();
  if (!normalized) {
    throw new Error("URL API manquante.");
  }
  if (normalized.startsWith("https://")) {
    return;
  }
  if (allowInsecureDev && normalized.startsWith("http://")) {
    return;
  }
  throw new Error("Les appels API de production doivent utiliser HTTPS.");
}

export const CERTIFICATE_PINNING_ARCHITECTURE_READY = true;
