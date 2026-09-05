# Audit RGPD / sécurité — 4 septembre 2026

**Mandat :** GitHub issue #503  
**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`  
**PR Draft :** lot P0 + P1 sur `cursor/p0-rgpd-security-aab-c225`  
**Pas de SIREN / société / adresse inventés.**

## Périmètre réel (code)

| Contrôle | État dans le dépôt |
|---|---|
| P0-1 Data API `anon`/`authenticated` | Migration + boot + gate |
| P0-2 Deny Superadmin/Admin Pays vs données établissement | Guard HTTP + RBAC avant `.some()` |
| Access token ≤ 15 min (défaut + garde prod) | `authTokenPolicy.js` |
| Refresh rotatif, hashé, logout, revoke-all, reuse | `sessionRefreshService.js` |
| Demande d’effacement tracée | `privacy_requests` + `/api/privacy/erasure-requests` |
| Anonymisation compte + révocation sessions | `executePrivacyErasure` — **ne supprime pas** notes/paiements/bulletins |
| Purge sessions / push | `retentionPolicy.js` — **pas** d’auto-purge audit ni dossier scolaire |
| Pages `/confidentialite` et `/suppression-compte` | Publiques Web + liens Mobile (accueil, menu, drawer) |
| Login Superadmin sans dump `auditLog` | P0-2 leftover : plus de journal établissement au login |
| Chemin auth réel / vars JWT | `docs/compliance/auth-sessions-p1.md` |
| Sauvegardes / restore | `docs/compliance/sauvegardes-restauration.md` (hébergeur, pas de job app) |

## Non clos par ce fichier

- Preuve dashboard Supabase « Data API disabled »
- DPA **signés** avec Render / Supabase / Expo et avec chaque établissement
- Hostname pooler Supabase live (région AWS) collé au registre — extraction ops, pas dans git
- AIPD **signée CTO** (`aipd-somafrik.md` est rédigée, pas close)
- Notification CNIL : pour les données scolaires, **l’établissement** notifie ; Somafrik notifie d’abord le responsable (`procedure-violation-donnees.md`)
- Promotion `main`, rebuild EAS AAB, import Play Data Safety en Console
- SMS / WhatsApp / e-mail transactionnel (non implémentés)

## Contact

RGPD : `contact@somafrik.app`  
Sécurité : `security@somafrik.app`
