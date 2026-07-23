# Rapport D3.4b — Contrat d’identité Parents et convergence des relations

**Type :** Convergence identité / données (pas de chrome DS)  
**Module :** Parents / Responsables  
**Impact runtime :** Oui — création / résolution des liaisons parent↔élève  
**Migration métier UI :** Non (écrans inchangés hors libellé champ)  
**Breaking change :** Les liaisons encore stockées avec `user.id` ne résolvent plus les enfants tant que non migrées (fallback téléphone réduit)

**Contrat :** [CONTRAT-D3.4b-identite-parents.md](./CONTRAT-D3.4b-identite-parents.md)  
**Prérequis :** tag `d3.4a`

---

## 1. Objectif

Aligner écriture et lecture sur le contrat CTO :

```
relations.fromContactId = contact.id
user.contactId = contact.id
```

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `web/src/lib/relations.ts` | Options = `contactId` ; lookup + normalisation au save |
| `parentChildRelationWorkflow.ts` | Canonicalisation avant sync ; lookup label par `contactId` |
| `entityColumns.tsx` | Affichage parent via `contactId` |
| `entityModules.ts` | Libellé « Parent (contact) » |
| `backend/lib/parentChildren.js` | Relations d’abord ; téléphone seulement si 0 résultat |
| `backend/lib/parentRelationIdentity.js` | Inventaire + migration idempotente |
| `scripts/migrate-parent-relation-contact-ids.js` | CLI inventaire |
| `scripts/verify-e2e-0012-…` | Scénarios identité séparés |
| `bulkPlatformSeed.js` | `fromContactId` = contact Parent |
| Docs DS | Contrat + rapport + suivi |

**Interdit (respecté) :** `ParentsListPage` · fiche Parent · chrome DS · réouverture EntityPage.

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Identité canonique | `contactId` |
| UI chrome / liste / fiche | Non |
| EntityPage rouvverte | Non |
| E2E 0012 sans double seed | Oui |
| Migration idempotente | Oui |
