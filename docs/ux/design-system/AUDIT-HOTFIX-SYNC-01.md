# Audit HOTFIX-SYNC-01 — Perte silencieuse à la synchronisation

**Date :** 2026-07-23  
**Verdict :** confirmé — snapshot serveur destructif + écritures locales non ACK  

---

## Séquence observée

1. Enseignant crée évaluation / appel  
2. Affichage immédiat (optimistic `DataContext.update`)  
3. PUT `/backoffice/state` → sync PG  
4. Échec rattachement (`Classe ou matiere introuvable…`) ou ignore migration (`console.warn`)  
5. Refresh / interval GET  
6. `mergeRemoteSnapshot` remplace l’état local  
7. Enregistrement disparaît  

---

## Points de rupture

| Zone | Fichier | Problème |
|------|---------|----------|
| Optimistic write | `web/src/context/DataContext.tsx` | Pas de rollback · pas d’outbox · pause sync 1,5 s puis refresh destructif |
| Merge | `web/src/lib/backofficeStateMerge.ts` | `evaluations` hors `SCHOOL_SCOPED_LIST_KEYS` → wipe par spread ; notes/présences : scope school remplace le pending |
| Attachment PG | `postgresRepository.upsertEvaluationFromLegacy` | Lookup classe/matière par nom exact |
| Sync BO Notes | `syncNotesDomainFromBackOffice` | Fail-fast global (1 erreur ⇒ rollback txn) |
| Migration | `migrate*FromBackOffice` | `console.warn` + continue |
| Mobile | `AdminDataContext.applySyncedState` | `applyArray` remplace ; catch → offline sans file |

---

## Absent avant HOTFIX

- `clientMutationId`  
- File durable pending/syncing/synced/failed  
- ACK par enregistrement  
- Préservation pending au merge  

Voir [CONTRAT-HOTFIX-SYNC-01.md](./CONTRAT-HOTFIX-SYNC-01.md).
