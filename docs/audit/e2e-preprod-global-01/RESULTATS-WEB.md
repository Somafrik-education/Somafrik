# E2E-PREPROD-GLOBAL-01 — Résultats Web (`https://preprod.somafrik.app`)

**Statut : 0 scénario Web exécuté en préproduction.** Tous les scénarios W de `MATRICE-E2E-GLOBALE.md` sont **BLOCKED**.

| Élément | État |
|---|---|
| Accès réseau à `preprod.somafrik.app` | Ouvert pendant la session : hôte ajouté au réseau de l'environnement |
| Interaction avec la préproduction | **Refusée** par le classifieur de permissions de l'environnement, au-delà d'un contrôle de disponibilité (BLK-PERM) |
| Comptes de test par rôle | **Non fournis** (BLK-AUTH) |
| SHA Web déployé | **Non relevé** : la lecture de la page a été refusée (BLK-PERM) |
| Outil disponible | Playwright et Chromium installés ; prêts pour une exécution réelle une fois le blocage levé |

Les 12 smokes Web manuels S01 à S12 déclarés PASS par le CTO restent la seule recette Web réelle connue. Ils ne sont pas repris ici comme preuves de cette campagne.

La couverture automatisée Web (Vitest, LOT 0–8, gates) figure dans `RESULTATS-API-POSTGRESQL.md` §2. Elle ne remplace pas l'E2E UI (mandat §4, phase 3).
