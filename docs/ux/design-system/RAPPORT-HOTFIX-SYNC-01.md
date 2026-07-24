# Rapport HOTFIX-SYNC-01 — Intégrité non destructive de la synchronisation

**Type :** Hotfix transversal (sync)  
**Impact runtime :** Oui (web DataContext + merge + persistance Notes BO)  
**Roadmap fonctionnelle :** Suspendue tant que la règle est garantie  

**Contrat :** [CONTRAT-HOTFIX-SYNC-01.md](./CONTRAT-HOTFIX-SYNC-01.md)  
**Audit :** [AUDIT-HOTFIX-SYNC-01.md](./AUDIT-HOTFIX-SYNC-01.md)  

---

## 1. Objectif

Garantir qu’une synchronisation ne peut jamais provoquer une perte silencieuse de données locales non confirmées.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `web/src/lib/syncOutbox.ts` | File durable `pending/syncing/synced/failed` + `clientMutationId` |
| `web/src/context/DataContext.tsx` | Enqueue avant PUT · `settleOutboxAfterHttpSave` (ACK Notes + ACK implicite BO snapshot) · réinjection pending · erreur visible · `retryFailedSync` |
| `web/src/lib/backofficeStateMerge.ts` | `evaluations` school-scoped · non-écrasement pending/failed |
| `backend/lib/gradesBoPersistence.js` | Strip partiel + conservation des rejets |
| `backend/db/postgresRepository.js` | Sync Notes par enregistrement + `syncAck` sur save |
| Tests | outbox · merge · gradesBoPersistence |

---

## 3. Note D3.6c

Le merge/tag `d3.6c` avait déjà été exécuté avant la suspension CTO du gate.  
HOTFIX-SYNC-01 est prioritaire sur la suite roadmap (D3.7, etc.).

---

## 4. Reste / suite

| Item | Statut |
|------|--------|
| Web outbox + merge pending | ✅ |
| ACK Notes PG par enregistrement | ✅ |
| Mobile `AdminDataContext` outbox | ⏳ suite |
| Présences API dédiée + outbox unifiée | ⏳ suite |
| Migration `console.warn` → dead-letter | ⏳ suite |
| UI journal sync enseignant | ⏳ (erreur DataContext + retry API) |

---

## 5. Tableau CTO

| Règle | Résultat |
|-------|----------|
| Pas de suppression locale sans ACK | Oui (outbox + merge) |
| Statuts pending/syncing/synced/failed | Oui |
| `clientMutationId` | Oui |
| ACK serveur Notes | Oui (`syncAck`) |
| Snapshot ancien n’écrase pas pending | Oui (tests) |
| Échec rattachement visible | Oui (`syncError` + `error` context) |
