# SEC-RBAC-REVOKE-01 — un rôle révoqué ne doit jamais être réattribué au démarrage

Priorité : P0 (sécurité des autorisations). Constat issu de MONO-T0-CLOSE (#1006).

## 1. Défaut

Un rôle révoqué pouvait redevenir actif au démarrage suivant du backend. Trois chemins de démarrage recréent des lignes `user_roles` à partir de données héritées :

| Chemin | Quand | Source héritée |
|---|---|---|
| `ensureUserRolesCanonicalSchema` → `backfillFromUsersRoleSql` | **chaque** démarrage, production comprise | `users.role` |
| `ensureUserRolesCanonicalSchema` → `backfillFromSecondaryRolesSql` | **chaque** démarrage, production comprise | `users.profile_payload.secondaryRoles` |
| `ensureSeededUserRoles` → `seedDeterministicUserRolesSql` | démarrage avec données de démonstration | `users.role` |

Les trois utilisent `INSERT … ON CONFLICT DO NOTHING`. Les index uniques de `user_roles` ne portent que sur les lignes **actives** :
- `user_roles_active_school_unique` ;
- `user_roles_active_platform_unique`.

Une ligne révoquée ne provoque donc aucun conflit, et une nouvelle ligne active est insérée.

### Reproduction (avant correctif, base PostgreSQL jetable, service réel `revokeUserRole`)

| Scénario | Avant | Après |
|---|---|---|
| Rôle secondaire hérité (`secondaryRoles`) révoqué via l'API | **réattribué** au démarrage | reste révoqué |
| Révocation enregistrée sans resynchroniser `users.role` | **réattribuée** | reste révoquée |
| Rôle plateforme (sans établissement) révoqué | **réattribué** | reste révoqué |
| Nouvel octroi explicite après une révocation | doublon de ligne active | une seule ligne active, historique conservé |
| Rôle primaire révoqué via l'API | non réattribué (l'API remet `users.role` à jour) | inchangé |
| Compte créé via l'API, dernier rôle révoqué | non réattribué | inchangé |
| Migration légitime d'un compte hérité sans `user_roles` | rôles créés | **toujours créés** |
| Isolation tenant (même rôle dans une autre école) | intacte | intacte |

Précision par rapport au premier signalement (#1006) : via l'API, le rôle **primaire** n'est pas réattribué, car `revokeUserRole` appelle `syncPrimaryRole`, qui réécrit `users.role`. Le chemin exploitable via l'API passe par `profile_payload.secondaryRoles`, que la révocation ne met pas à jour. La mesure « 110 → 111 » de #1006 révoquait par SQL direct, ce qui correspond au scénario « révocation sans resynchronisation ».

## 2. Source de vérité

`user_roles` est la seule source de vérité des attributions.
- Le RBAC live ne lit que les lignes actives : `liveRbacPrincipalAuthority` → `listActiveUserRoleKeysForSchool` / `listActiveUserRoleKeys`.
- `users.role` est le rôle primaire affiché ; `profile_payload.secondaryRoles` est un reliquat d'import. Ces deux champs ne servent plus qu'à **migrer** un compte qui n'a encore aucune décision canonique pour un rôle donné.

Règle introduite : **une ligne révoquée pour (utilisateur, établissement, rôle) est une décision explicite.**
- Aucun chemin automatique (démarrage, seed, réparation Démo, mode mémoire) ne la renverse.
- Seul un nouvel octroi via l'API (`grantUserRole`, avec contrôle d'accès et audit) peut réactiver ce rôle.

## 3. Correctif

| Fichier | Modification |
|---|---|
| `backend/db/userRolesSchema.js` | Nouveau prédicat `notExplicitlyRevokedSql(user, établissement, rôle)` ajouté aux trois `INSERT` de démarrage et à `missingMappedUserRolesSql`. Un rôle révoqué n'est plus « manquant », donc le seed démo n'échoue pas à cause d'une révocation. Comparaison `school_id IS NOT DISTINCT FROM` (rôles plateforme compris) et `upper(role_key)`. |
| `backend/lib/memoryUserRolesBackfill.js` | Même règle pour le dépôt mémoire (développement uniquement). |
| `backend/lib/demoCanonicalRoleRepair.js` | Le script d'exploitation `repair-demo-role-memberships` ne réattribue plus un rôle révoqué ; ces rôles sont comptés dans `skippedRevoked`. Si la preuve exige ensuite un administrateur ou un enseignant actif, le script échoue explicitement au lieu de réattribuer en silence. |

Ce qui n'est pas modifié :
- les règles RBAC, les permissions et le catalogue des rôles ;
- le schéma de production : aucune migration, aucun index ;
- `grantUserRole` et `revokeUserRole` ;
- les comptes existants : aucune ligne n'est créée, modifiée ou supprimée par le correctif.

Le correctif retire uniquement une recréation automatique ; il ne peut élargir aucun privilège.

## 4. Migrations légitimes

Un compte hérité sans aucune ligne `user_roles` pour un rôle reçoit toujours ce rôle au démarrage : rôle primaire et rôles secondaires, idempotent, sans doublon. Ce cas est couvert par un test dédié.

Seul cas désormais non migré : un tuple déjà révoqué, c'est-à-dire une décision canonique antérieure.

## 5. Tests

- `backend/lib/secRbacRevoke01.pg.test.js` (nouveau, PostgreSQL jetable, service réel) : 8 scénarios. **4 échouent sans le correctif ; les 8 passent avec.** Les deux chemins de démarrage sont rejoués ; les permissions effectives sont vérifiées via la lecture du RBAC live.
- `backend/lib/memoryUserRolesBackfill.test.js` : +1 test (rouge sans correctif).
- `backend/lib/demoAssignments.greenB.test.js` : +1 test (rouge sans correctif) ; le faux client répond désormais à la requête de révocation.

## 6. Risques résiduels

1. **Données héritées divergentes.** `profile_payload.secondaryRoles` et `users.role` peuvent continuer à afficher un rôle révoqué (affichage, export). Ce n'est plus une autorité, mais un nettoyage de ces champs lors de la révocation (ou leur retrait) relève d'un lot distinct.
2. **Révocation puis migration réellement souhaitée.** Si une organisation voulait qu'un ancien rôle révoqué soit réactivé par une donnée héritée, ce n'est plus automatique : il faut un octroi explicite via l'API, ce qui est voulu.
3. **Autres écritures directes en base**, hors application : les outils SQL d'exploitation ne passent pas par ces gardes. Hors périmètre.
