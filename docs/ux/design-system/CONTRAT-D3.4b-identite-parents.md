# Contrat d’identité Parents — D3.4b

**Lot :** D3.4b — Contrat d’identité Parents et convergence des relations  
**Statut :** normatif pour les écritures / résolutions parent↔élève  
**Base :** tag `d3.4a` · décisions CTO [AUDIT-D3.4 §10](./AUDIT-D3.4-parents.md#10-décisions-cto--arbitrages-du-gate)  
**Hors lot :** liste Parents · fiche Parent · chrome DS · réouverture EntityPage

---

## 1. Identifiants

| Identifiant | Nature | Rôle |
|-------------|--------|------|
| `contact.id` | Métier | Identité canonique du parent (personne / contact) |
| `user.contactId` | Lien compte → contact | **Doit** égaler `contact.id` |
| `user.id` | Technique | Authentification / session uniquement |
| `relations.fromContactId` | Clé métier liaison | **Doit** égaler `contact.id` |
| `student.parentPhone` / `parentName` | Legacy | Projection temporaire — pas d’autorité pour créer une liaison |

---

## 2. Contrat cible

```
relations.fromContactId = contact.id
user.contactId          = contact.id
```

- `user.id` **ne doit pas** être stocké dans `relations.fromContactId`.
- Création UI : options parent = `user.contactId` ; normalisation au save via `prepareRelationForSave` / `resolveParentContactId`.
- Résolution enfants (`resolveParentChildren`) :
  1. match `user.contactId` ↔ `relations.fromContactId`
  2. fallback téléphone **uniquement** si aucune relation n’a produit d’enfant

---

## 3. Surfaces (inchangées — D3.4a)

| Surface | Rôle |
|---------|------|
| Parents & élèves | Admin des liaisons |
| Responsables (fiche Élève) | Vue élève-centrée |
| Comptes utilisateurs | Auth / rôle Parent |

---

## 4. Migration opérationnelle (persistée)

Helper : `backend/lib/parentRelationIdentity.js`

| Fonction | Rôle |
|----------|------|
| `inventoryParentRelations` | Classe les liaisons (`canonical`, `legacy_user_id`, `legacy_missing_contact`, …) |
| `migrateParentRelationsToContactId` | Remap idempotent `user.id` → `user.contactId` **si et seulement si** le contact cible existe dans `contacts` |

### Prérequis

1. Backend joignable (`SOMAFRIK_API_URL`, défaut `http://127.0.0.1:5000/api`)
2. Compte superadmin ops (`SOMAFRIK_E2E_SUPERADMIN_ID` / `SOMAFRIK_E2E_SUPERADMIN_PASSWORD`)
3. Fenêtre de maintenance courte recommandée (PUT state relations)

### Procédure exécutable

```bash
# 1) Inventaire lecture seule (aucune écriture)
node scripts/migrate-parent-relation-contact-ids.js

# 2) Vérifier le résumé :
#    - legacy_user_id = lignes migrables
#    - legacy_missing_contact = user.contactId absent du registre (non touchées)

# 3) Persistance sûre : sauvegarde JSON locale + putStatePatch({ relations })
node scripts/migrate-parent-relation-contact-ids.js --apply --confirm

# 4) Relancer l'inventaire : legacy_user_id doit être 0 ; second apply no-op
node scripts/migrate-parent-relation-contact-ids.js
```

### Garanties du script `--apply --confirm`

| Garantie | Comportement |
|----------|--------------|
| Canal store | API BackOffice `GET/PUT /api/backoffice/state` (même canal E2E) |
| Sauvegarde | `tmp/parent-relation-migration-backup-<timestamp>.json` avant écriture |
| Périmètre écrit | `relations` uniquement |
| Contact cible | pas de remap si `user.contactId` ∉ `contacts` |
| Comptage | inventaire avant / plan / après persistance |
| Idempotence | second passage `changed === 0` (sinon exit 1) |
| Confirmation | `--apply` **refuse** sans `--confirm` |

### Hors script

Corriger manuellement les lignes `legacy_missing_contact` (créer/réparer le contact, puis relancer).

---

## 5. E2E 0012

Scénarios séparés :

1. Résolution par relation (sans `parentPhone`)
2. Fallback téléphone (sans relations)
3. `fromContactId = user.id` → 0 enfant
4. Migration → résolution OK
