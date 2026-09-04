# Procédure — violation de données

**Contact interne :** `security@somafrik.app` et `contact@somafrik.app`  
**Décideur notification CNIL / établissements :** CTO (pas Cursor)

## 1. Détection

Signalement, alerte logs, constat audit (ex. incident Data API 2026-09-04).

## 2. Confinement

- Révoquer clés / sessions (`POST /api/auth/revoke-all`, rotation `JWT_SECRET` sous GO ops)
- Relancer lockdown Data API si grants `anon`/`authenticated`
- Ne pas écrire en production depuis Cursor

## 3. Qualification (72 h CNIL si risque pour les personnes)

Critères : nature des données, volume, identifiabilité, mitigation déjà en place.  
L’incident Supabase 2026-09-04 : surface théorique PostgREST ; exploitation non prouvée dans git. Voir `incident-supabase-2026-09-04.md`.

## 4. Notification

| Destinataire | Qui décide | Contenu |
|---|---|---|
| CNIL | CTO | nature, catégories, mesures, contact |
| Établissements | CTO | sans secrets, sans listes d’élèves |
| Personnes | si risque élevé | canal établissement |

## 5. Preuve

Conserver : timeline, SHA git, tickets, **pas** de dumps nominatifs dans le dépôt.
