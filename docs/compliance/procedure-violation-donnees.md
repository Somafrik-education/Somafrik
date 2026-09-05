# Procédure — violation de données

**Contact interne :** `security@somafrik.app` et `contact@somafrik.app`  
**Opérateur :** Baudouin Okito — France  
**Cursor n’est pas décideur** de notification. **CTO = GO/NO GO** des actes ops (révocation de secrets, messages, tickets).

## Rôles RGPD (ne pas inverser)

| Traitement | Rôle Somafrik | Qui notifie l’autorité | Qui notifie les personnes |
|---|---|---|---|
| Données scolaires saisies par l’établissement (élèves, familles, notes, présences, paiements, documents, comptes école) | **Sous-traitant** (art. 28) | **Le responsable de traitement = l’établissement**, sauf mandat écrit spécifique | L’établissement, sauf instruction contraire documentée |
| Comptes opérateurs plateforme, journaux techniques d’infrastructure, facturation d’abonnement Somafrik | **Responsable** | L’opérateur Somafrik (décision CTO) | L’opérateur si risque élevé |

La CNIL rappelle que **le responsable de traitement** notifie l’autorité **dans les 72 heures** après en avoir pris connaissance, lorsque la violation est susceptible d’engendrer un risque pour les droits et libertés. Ce délai de 72 h **n’est pas** une obligation directe du sous-traitant vis-à-vis de la CNIL.

## 1. Détection

Signalement, alerte logs, constat audit (ex. incident Data API 2026-09-04).

## 2. Confinement

- Révoquer clés / sessions (`POST /api/auth/revoke-all`, rotation `JWT_SECRET` sous GO ops)
- Relancer lockdown Data API si grants `anon`/`authenticated`
- Ne pas écrire en production depuis Cursor

## 3. Qualification

Critères : nature des données, volume, identifiabilité, mitigation déjà en place, **qui est responsable**.  
L’incident Supabase 2026-09-04 : surface théorique PostgREST ; exploitation non prouvée dans git. Voir `incident-supabase-2026-09-04.md`.

## 4. Notification — ordre obligatoire

### 4.1 Données scolaires (Somafrik sous-traitant)

1. **Notifier l’établissement responsable sans délai injustifié** (art. 33.2 RGPD) : nature, catégories approximatives, mesures, contact, **sans secrets**, **sans listes d’élèves**.
2. L’établissement décide de la notification à la CNIL (ou autorité locale) et aux personnes. Somafrik assiste (art. 28.3.f) ; Somafrik **ne se substitue pas** au responsable.
3. Somafrik ne saisit la CNIL pour ces données **que** si un mandat écrit de l’établissement le prévoit.

### 4.2 Traitements où Somafrik est responsable

| Destinataire | Qui décide | Contenu |
|---|---|---|
| CNIL | CTO | nature, catégories, mesures, contact — **dans les 72 h** si risque pour les personnes |
| Personnes | CTO si risque élevé | canal opérateur |

## 5. Preuve

Conserver : timeline, SHA git, tickets, accusés d’information aux établissements, **pas** de dumps nominatifs dans le dépôt.
