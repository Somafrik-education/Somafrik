# Matrice de conservation

**Configurable via env.** Le job applicatif ne promet que ce qu’il exécute (`backend/lib/retentionPolicy.js`).

| Donnée | Durée par défaut | Purge auto | Exception |
|---|---|---|---|
| Access JWT | ≤ 15 min | expiration JWT | — |
| Refresh / sessions | 7 jours après expiry (`SOMAFRIK_RETENTION_SESSIONS_DAYS`) | oui | révocation logout / reuse / erasure immédiate |
| Jetons push | 90 jours d’inactivité | révocation | erasure de compte |
| Receipts Expo | 2 jours | oui | — |
| Demandes privacy | 24 mois (trace) | non (hors lot) | — |
| Notifications in-app | durée d’usage | non | — |
| Messages / PJ | tant que le fil / l’annonce existe | non | fichier orphelin : hors job |
| Exports établissement | non persistés comme fichier durable côté API (snapshot lecture) | n/a | — |
| Comptes désactivés / anonymisés | statut `deleted` conservé pour intégrité FK | non | — |
| Dossier scolaire / financier | **instruction établissement / obligation légale** | **non** | notes, présences, bulletins, paiements |
| Audit logs | **non auto-purgé** | non | preuve sécurité |
| Sauvegardes hébergeur | politique Supabase / Render | hors app | restauration ops |

Job : `purgeRetention(repository)` — testé unitairement. Pas de cron production activé depuis ce lot (à brancher ops sous GO CTO).
