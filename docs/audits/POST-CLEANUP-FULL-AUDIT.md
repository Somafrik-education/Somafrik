# POST-CLEANUP-FULL-AUDIT — enseignants préproduction

## Périmètre exhaustif

- 59 fiches enseignants Backoffice/PostgreSQL.
- 97 lignes users Backoffice, dont 92 au rôle enseignant.
- 91 users PostgreSQL, dont 90 au rôle enseignant.
- 59 identités enseignantes canoniques après résolution des aliases BO/PostgreSQL.

Les 92 lignes BO se répartissent en 59 comptes directement liés, 19 aliases PostgreSQL résolus vers ces comptes et 14 comptes supprimés sans teacher attendu. Côté PostgreSQL : 59 comptes directement liés, 17 aliases résolus et 14 comptes supprimés sans teacher attendu. Aucun compte actif incohérent n'est resté sans correspondance.

## Résultat du scan complet

| Contrôle | Résultat |
|---|---:|
| doublons `schoolCode + userId` | 0 |
| doublons `schoolCode + contactId` | 0 |
| collisions `schoolCode + identifier` | 0 |
| collisions `schoolCode + publicId` | 0 |
| comptes BO incohérents sans teacher | 0 |
| comptes PG incohérents sans teacher | 0 |
| teachers sans user/contact attendu | 0 |
| teachers avec user BO manquant | 0 |
| teachers PostgreSQL avec user manquant | 0 |
| suspicions même identité civile + naissance + école sans lien technique | 0 |
| références BO pendantes | 0 |
| références BO vers les deux IDs supprimés | 0 |
| références PostgreSQL pendantes | 0 |
| références PostgreSQL vers les deux IDs supprimés | 0 |

## Synchronisation globale x10

La synchronisation a été exécutée réellement en préproduction sur les 59 identités canoniques, après résolution des 33 lignes BO non canoniques en aliases ou comptes supprimés sans teacher attendu.

| Passage | Nombre de teachers | SHA-256 de l'ensemble trié des IDs |
|---:|---:|---|
| 1 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 2 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 3 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 4 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 5 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 6 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 7 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 8 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 9 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |
| 10 | 59 | `4d335070721f946fd93c3dbde38e5c93897b289be3f53388028e3b6c91d82420` |

Critère final : **59 avant, pendant et après ; ensemble des IDs strictement identique**.

- Snapshot avant sync globale : `484dd9610e395ff967ad09fb5ac0122d7b455af45895bd3f08b52c2d25c74448`.
- Snapshot après sync globale : `b1527114366733de7afdd07109fa13806bb9e89765523e805f528539612f9740`.
- Preuve machine : `docs/audits/evidence/POST-CLEANUP-FULL-AUDIT.json`.

Aucun nouveau `DELETE` n'a été exécuté pendant cette revalidation.
