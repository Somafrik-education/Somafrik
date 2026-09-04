# Matrice de conservation

**Date :** 2026-09-04  
**Opérateur / responsable (traitements plateforme) :** Baudouin Okito — France — `contact@somafrik.app`  
**Code :** `backend/lib/retentionPolicy.js`  
Le job applicatif ne promet que les lignes « purge auto = oui ». Aucune durée unique n’est inventée pour tout le dossier scolaire.

Légende **purge auto** : exécutée par `purgeRetention(repository)` / `node backend/scripts/purge-retention.js` (idempotent). Pas de cron production dans ce lot.

| Donnée | Finalité | Base (indicative) | Archivage | Déclencheur | Durée / critère | Action finale | Responsable | Job / commande | Preuve test |
|---|---|---|---|---|---|---|---|---|---|
| Access JWT | Auth | Intérêt légitime / contrat | non | émission | ≤ 15 min (`JWT_ACCESS_TTL_SECONDS`, max prod 900 s) | expiration cryptographique | Opérateur | n/a (TTL) | `verify:auth-sessions`, `authTokenPolicy.test.js` |
| Refresh / sessions | Auth persistante | Intérêt légitime / contrat | non | logout, reuse, erasure, expiry | 7 j après `expires_at` (`SOMAFRIK_RETENTION_SESSIONS_DAYS`) | révocation immédiate ; DELETE après cutoff | Opérateur | `purgeRetention` | `retentionPolicy.test.js`, `verify:auth-sessions` |
| Jetons push | Notifications | Intérêt légitime / consentement canal | non | inactivité / erasure | 90 j (`SOMAFRIK_RETENTION_PUSH_DAYS`) | `revoked_at` | Opérateur | `purgeRetention` | `retentionPolicy.test.js` |
| Receipts Expo | Dédup push | Intérêt légitime | non | création | 2 j | DELETE | Opérateur | `purgeRetention` | `retentionPolicy.test.js` |
| Audit logs | Sécurité, imputabilité | Intérêt légitime / obligation | non (preuve) | écriture serveur | **non bornée par l’app** | **pas de purge auto** | Opérateur + établissement selon accès | aucun | politique `auditLogsDays: null` |
| Notifications in-app | Information utilisateur | Contrat / intérêt légitime | non | usage | durée d’usage du fil | pas de job | Établissement (contenu) | aucun | matrice (hors job) |
| Messages / PJ | Communications école | Contrat établissement | avec l’entité parente | suppression entité | tant que le fil / l’annonce existe | pas de job PJ orphelines | Établissement | aucun | `pieces-jointes.md` |
| Exports établissement | Portabilité / copie | Instruction responsable | non persisté API | `GET /api/data-export` | snapshot lecture, pas de fichier durable serveur | n/a | Établissement (403 plateforme) | aucun | `verify:data-export-safety` |
| Comptes désactivés / anonymisés | Intégrité FK, non-réidentification | Obligation / contrat | ligne `users` conservée | erasure exécutée | statut `deleted` / « Supprimé » | pas de DELETE physique | Établissement + opérateur | `executePrivacyErasure` | `verify:privacy-erasure` |
| Demandes privacy | Preuve droits | Obligation art. 12-17 | oui (trace) | création | 24 mois visés, **pas purgé** par le job | conservation de la demande | Opérateur | aucun (hors lot) | HTTP 201 pending |
| Données scolaires (notes, présences, bulletins, docs, inscriptions) | Dossier élève | Contrat / obligation scolaire locale | selon établissement | fin de scolarité / instruction | **critère établissement / loi locale — pas une durée unique Somafrik** | **pas d’auto-suppression** | Établissement (responsable) | aucun | `schoolRecordsRetained: true` |
| Données financières (paiements, grilles, obligations) | Comptabilité scolarité | Obligation comptable / contrat | selon établissement | exercice / instruction | **idem, pas de durée unique** | **pas d’auto-suppression** | Établissement | aucun | erasure ne touche pas `payments` |
| Sauvegardes hébergeur | Continuité | Intérêt légitime | snapshots Supabase / Render | politique prestataire | **durée prestataire, pas dans git** | restore ops ; réappliquer erasure | Ops sous GO CTO | dashboard hébergeur | `sauvegardes-restauration.md` |

Job : `purgeRetention` est **idempotent** (DELETE/UPDATE déjà traités = 0 ligne). Cron prod : à brancher sous GO CTO.
