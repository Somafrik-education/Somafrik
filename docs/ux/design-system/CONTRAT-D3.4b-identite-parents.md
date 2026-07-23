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

## 4. Migration

Helper : `backend/lib/parentRelationIdentity.js`

| Fonction | Rôle |
|----------|------|
| `inventoryParentRelations` | Classe canonical / legacy_user_id / orphan… |
| `migrateParentRelationsToContactId` | Remap idempotent `user.id` → `user.contactId` |

Script : `node scripts/migrate-parent-relation-contact-ids.js [--dry-run\|--apply]`

---

## 5. E2E 0012

Scénarios séparés :

1. Résolution par relation (sans `parentPhone`)
2. Fallback téléphone (sans relations)
3. `fromContactId = user.id` → 0 enfant
4. Migration → résolution OK
