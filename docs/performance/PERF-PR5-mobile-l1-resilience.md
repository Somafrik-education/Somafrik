# PERF-PR5 — Mobile : cache L1, connexion faible et affichage immédiat

Statut : **DRAFT / HOLD**. Base : `develop` à `87278e647` (PERF-PR1 #1062, PERF-PR2 #1063, PERF-PR3 #1064, PERF-PR4 #1065 inclus). Ni backend, ni Web, ni schéma L1, ni outbox modifiés. Correction de sécurité incluse : **séparation des caches L1 par environnement** (§7 bis).

## 1. Architecture avant / après

### Avant

- `loadL1BackedSnapshot` (lecteur unique) :
  - lit le réseau d'abord ;
  - se replie sur SQLite **uniquement** sur `NETWORK_UNAVAILABLE` ;
  - un `TIMEOUT` (20 s) ou un `BACKEND_UNREACHABLE` laisse l'écran vide, même avec une copie L1 prête et autorisée.
- Aucune lecture locale tant que le réseau n'a pas répondu : avec une connexion lente, l'écran attend la réponse complète.
- Chaque retour d'écran relit toutes les ressources. Deux composants ou deux appels dans le même effet produisent deux requêtes (`HomeScreen` appelle `loadClasses()` deux fois).
- Les écrans affichent la date brute ISO de `cachedAt`, seulement en mode hors ligne.

### Après

| Élément | Changement |
|---|---|
| `offline/l1/readModel.ts` | Repli sur la dernière copie L1 pour `NETWORK_UNAVAILABLE`, `TIMEOUT` et `BACKEND_UNREACHABLE` (aucune réponse HTTP). Option `onCacheSnapshot` : lecture L1 en parallèle du réseau, montrée dès qu'elle est prête si le réseau n'a pas encore répondu. 401/403 marqués `accessDenied`. |
| `offline/l1/l1LoadCoordinator.ts` (nouveau, sans React) | Déduplication, fraîcheur courte, générations, décisions de fusion (`applyCacheFirst`, `settleL1Snapshot`). |
| `context/AdminDataContext.tsx` | Les 5 loaders L1 passent par `runL1BackedLoad` (coordinateur + cache-first). Signature compatible : `loadX(options?)`. |
| `lib/dataTruth.ts` | `ResourceSnapshot` : champs optionnels `refreshing`, `refreshFailed`, `accessDenied`. |
| `offline/l1/environment.ts` (nouveau), `offline/l1/database.ts` | Fichier SQLite et clé SQLCipher propres à chaque environnement (profil de build + URL de l'API). L'ancien fichier commun n'est plus jamais ouvert. |
| `lib/l1Freshness.ts`, `components/L1FreshnessNote.tsx` (nouveaux) | Ligne discrète de fraîcheur, sans notification. |
| Écrans | `HomeScreen`, `ClassesScreen` et `StudentsScreen` : le retour d'écran passe `{ maxAgeMs: 30 000 }`. Classes, Élèves, Planning et Cours affichent la ligne de fraîcheur. |

Le cache reste celui de L1 (SQLCipher, partition `userId + schoolId`). Aucun second cache, aucune table, aucune migration.

## 2. Ressources L1 couvertes

Confirmées par l'audit (`L1_RESOURCES`, `offline/l1/types.ts`) :

| Ressource L1 | Loader | Écrans |
|---|---|---|
| `classes` | `loadClasses` | Accueil, Classes, Élèves, Enseignants |
| `students` | `loadStudents` | Accueil, Classes, Élèves |
| `assignments` | `loadAssignments` | Accueil (enseignant), Classes, Élèves, Enseignants |
| `school-courses` | `loadSchoolCourses` | Structure pédagogique |
| `course-schedules` | `loadPlanningWeekly` (`loadCourseSchedules`) | Planning |

Paiements, notes et présences ne sont **pas** dans L1 et ne sont pas touchés.

## 3. Règles de fraîcheur

| Appel | Comportement |
|---|---|
| Sans option (20 appels : rafraîchissement manuel, `onChanged` après mutation, Planning, Enseignants, structure pédagogique) | **Toujours** une lecture réseau. Toute lecture plus ancienne de la même ressource devient obsolète. |
| `{ maxAgeMs: 30 000 }` (8 appels de retour d'écran : Accueil, Classes, Élèves) | Réutilise la lecture en cours. Ne relit pas si la dernière **réponse réseau** de la même clé a moins de 30 s. |

- La clé est `portée de ressources (utilisateur, rôle, établissement actif) | état des droits | ressource`.
- Un changement d'établissement, de compte ou d'état des droits (`ready` ↔ `ready_offline`) n'hérite donc d'aucune fraîcheur ni d'aucune lecture en cours. `resetTenantResourceCaches` remet aussi le coordinateur à zéro.
- La fraîcheur est marquée uniquement par une réponse réseau. Une copie L1 ne la prolonge jamais, et un 401/403 l'efface.
- **Changement d'établissement** (`markTenantResourcesSwitching`) et **relecture complète** (`refreshBackOfficeState`, appelée après des mutations et après la synchronisation) remettent le coordinateur à zéro. Toutes les lectures L1 en vol deviennent obsolètes et toutes les fraîcheurs sont effacées. Un aller-retour A → B → A relit donc A au lieu de garder un écran vidé.
- **Outbox** : la synchronisation de l'outbox relit présences, notes et paiements (hors L1, inchangé). Toute relecture des ressources L1 après mutation (`onChanged`) est un appel **sans option**, donc jamais sautée.

## 4. Stratégie de repli

Séquence d'une lecture, une fois les droits établis :
1. La lecture L1 démarre **en parallèle** du réseau.
2. Si la copie arrive avant le réseau **et** que rien n'est affiché pour la portée, elle est affichée avec `refreshing: true` (« Actualisation en cours »).
3. Le réseau répond :
   - **200** : la réponse remplace la copie, sans libellé de fraîcheur, et marque la fraîcheur ;
   - **`TIMEOUT`, `BACKEND_UNREACHABLE`, `NETWORK_UNAVAILABLE`** (aucun statut HTTP) : dernière copie L1 avec `refreshFailed: true` (« Actualisation impossible — dernières données disponibles ») ;
   - **401/403** : `accessDenied`, la copie affichée est **retirée** et aucun repli n'a lieu ;
   - **500** ou autre réponse HTTP : erreur explicite, aucun repli.
4. Sans copie L1 :
   - `NETWORK_UNAVAILABLE` garde le résultat historique « Cache hors ligne indisponible » ;
   - `TIMEOUT` et `BACKEND_UNREACHABLE` donnent une erreur explicite ;
   - dans les deux cas, jamais une liste « vide confirmée ».
5. Échec sans copie lisible : les lignes déjà affichées pour la portée restent visibles.

L'écriture du cache L1 est inchangée : seul `L1CacheRuntime` / `syncL1Cache` écrit SQLite, et seulement après `ready`.

## 5. Gestion du délai

- Client Mobile inchangé : `REQUEST_TIMEOUT_MS = 20 000`, `AbortController` par requête, codes `TIMEOUT`, `NETWORK_UNAVAILABLE` et `BACKEND_UNREACHABLE` (`services/httpClient.ts`).
- Avec une copie L1, l'utilisateur voit les données pendant ces 20 s au lieu d'un écran vide. Le délai lui-même n'est pas modifié.
- Une lecture expirée ne relance **jamais** d'écriture. L'outbox, l'idempotence, l'ordre et les mutations autorisées hors ligne ne sont pas modifiés. Les mutations restent bloquées tant que la source affichée est `l1-cache` (`shouldBlockUnsupportedMutations`, inchangé).

## 6. Déduplication

- Seuls les appels de retour d'écran (`maxAgeMs`) rejoignent une lecture en cours.
- Une lecture forcée (après mutation, rafraîchissement explicite) n'en rejoint jamais une : elle démarre une nouvelle génération et la réponse antérieure est ignorée.
- Une réponse plus ancienne qu'une réponse récente ne remplace ni les données ni la fraîcheur.

## 7. Sécurité des sessions

| Situation | Mécanisme |
|---|---|
| Droits non établis (`loading`, `error`, `idle`) | `canReadL1BeforeNetwork` faux : aucune lecture L1 avant le réseau (fail-closed). |
| 401 / 403 sur une lecture | Jamais de repli. La copie affichée est retirée et la fraîcheur effacée. |
| 401 / 403 sur `effective-permissions` | Inchangé : `onAuthFailure` → `invalidateL1CacheSession` (purge de la partition) puis déconnexion. |
| 401 sur la synchronisation L1 | Inchangé : purge de la partition. |
| 403 sur la synchronisation L1 | Inchangé : `blocked_authorization`, la ressource n'est plus lisible, même hors ligne (testé). |
| Changement d'utilisateur ou d'établissement | Partition `userId + schoolId` stricte (`readL1Resource`). Clé de coordinateur liée à la portée. `adoptL1Runtime` purge la partition précédente. |
| Déconnexion, session absente | `invalidateL1CacheSession` (inchangé). Sans session : aucune lecture. |
| Hors ligne validé (`ready_offline`) | Inchangé : lecture L1 sans GET à partir de l'instantané de droits validé par le serveur. Libellé « Mode hors connexion ». |
| Préproduction / production | **Corrigé dans PERF-PR5** : fichier et clé SQLCipher distincts par environnement (§7 bis). |

Une donnée présente dans SQLite n'est jamais une autorisation.

### 7 bis. Séparation des environnements (correctif de sécurité)

**Constat de l'audit.** Aucune isolation n'existait ailleurs dans l'architecture :
- tous les profils (`development`, `preview`, `preproduction`, `production`) partagent `com.somafrik.app` (`config/releaseEnvironments.js`) ;
- ils partagent le fichier `somafrik-l1-v1.db` et la clé SecureStore `somafrik.l1DbKeyV1` ;
- les jetons de session et l'instantané de droits hors ligne sont eux aussi stockés sous des clés communes.

Un appareil passant d'une version préproduction à une version production (même signature) rouvrait donc le même cache chiffré. La seule barrière était `userId + schoolId`.

**Correctif, sans migration de schéma.**
- `resolveL1EnvironmentStorage({ releaseProfile, apiRoot })` donne un identifiant d'environnement non secret : `<profil>-<FNV-1a de l'URL d'API normalisée>`.
- Le fichier SQLite devient `somafrik-l1-v1-<id>.db` et la clé SecureStore `somafrik.l1DbKeyV1.<id>`.
- `openNativeL1Database` refuse d'ouvrir tout cache si l'environnement ne peut pas être déterminé (fail-closed).
- L'ancien fichier commun, d'environnement d'origine inconnu, **n'est plus jamais ouvert**. Rien n'est supprimé, rien n'est migré.
- Le premier lancement après mise à jour repart d'un cache vide pour l'environnement courant, puis `L1CacheRuntime` resynchronise.

**Effet sur la session partagée.** Une session préproduction restaurée dans une version production :
- en ligne : premier appel → 401 → purge (inchangé) ;
- hors ligne (`ready_offline`) : partition préproduction absente du fichier production → `metadata_absent`, aucune donnée.

**Tests de non-contamination** (`l1SqliteCache.test.ts`) :
- fichiers et clés distincts ;
- même environnement → même stockage ;
- environnement indéterminé → refus ;
- production avec le même `userId + schoolId` ne voit ni la préproduction ni l'ancien fichier commun ;
- la préproduction reste intacte ;
- la clé préproduction est refusée sur le fichier production. La lecture exige une session dont les droits ont été établis, une partition identique et `meta.state === "ready"`.

## 8. Tests

| Fichier | Couverture |
|---|---|
| `Mobile/src/offline/l1/l1Resilience.perfPr5.test.ts` (28) | **Lecture :** réseau rapide ; réseau lent (copie puis réponse) ; `TIMEOUT`, `BACKEND_UNREACHABLE` et `NETWORK_UNAVAILABLE` avec cache ; cache absent + `TIMEOUT` ; réseau rétabli ; réponse serveur remplaçant la copie ; échec conservant les lignes affichées ; cache-first sans écraser une donnée affichée. **Sécurité :** 401 et 403 (copie retirée) ; droits non établis ; changement d'utilisateur ; changement d'établissement ; déconnexion ; révocation (`blocked_authorization`) ; `ready_offline` sans GET ; classification des erreurs. **Concurrence :** deux composants ; navigation rapide (< 30 s, puis > 30 s) ; actualisation explicite et après mutation ; réponse ancienne après une récente ; portées et remise à zéro. **Changements de contexte :** aller-retour d'établissement A → B → A pendant une lecture ; mutation puis synchronisation (fraîcheur 30 s sans effet) ; copie cache-first d'une portée quittée jamais appliquée. **Fraîcheur :** libellés et dates issues des métadonnées, jamais inventées. |
| `Mobile/src/offline/l1/l1OfflineReads.test.ts` (adapté) | L'assertion historique « `TIMEOUT` → aucun repli » devient « `TIMEOUT` et `BACKEND_UNREACHABLE` → copie L1 signalée `refreshFailed` », comme le demande le mandat. 401, 403 et 500 restent sans repli. |
| `Mobile/src/offline/l1/l1SqliteCache.test.ts` (complété) | Séparation des environnements (§7 bis). |
| `Mobile/scripts/verify-mobile-l1-offline-reads.js` | Exécute aussi le nouveau test (déjà appelé par PR Gates). |

Exécutés localement : typecheck Mobile, `test:l1-offline-reads`, `test:l1-sqlite-cache`, `test:l1-hydration-red`, `verify:mobile-l1-offline-reads`, `verify:mobile-rc2-offline-read-smoke`, `verify:mobile-planning-v2`, `verify:mobile-data-truth`, `verify:mobile-network-resilience`, `verify:mobile-security`, `verify:mobile-live-permissions-refresh` et tous les autres scripts `verify:*` et `test:*` du Mobile, hors natifs.

`verify:mobile-l1-sqlite-cache` a tourné avec `SOMAFRIK_SKIP_L1_PREBUILD=1` : contrôles et tests sans prebuild natif Android.

#### Échecs préexistants

Commande : `npm --prefix Mobile run -s <script>`, exécutée sur `develop` à `87278e647` (copie de travail sans le diff PERF-PR5) puis sur la branche. Aucun test désactivé.

| Script | `develop` | Branche | Extrait du log (identique des deux côtés) | Cause |
|---|---|---|---|---|
| `verify:mobile-form-fields` | échec | échec | `AssertionError: TextInput métier hors FormField. Migrer vers le composant canonique :` `components/ClassHeadTeacherControls.tsx`, `components/CommunicationChrome.tsx`, `components/StudentCardRollCallModal.tsx`, `help/HelpSheet.tsx`, `screens/ExamsScreen.tsx`, `screens/InternalNotificationsScreen.tsx` | `TextInput` hors `FormField` dans des fichiers non touchés |
| `verify:mobile-usability` | échec | échec | `The input did not match the regular expression /onRefresh=\{\(\) => void load\(\)\}/` | contrôle sur `TeachersScreen`, `UsersScreen` et `AnnouncementsScreen` (non touchés) |
| `verify:mobile-no-catalog-runtime-data` | échec | échec | `The input was expected to not match the regular expression /from ["']\.\.\/data\/catalog["']/` | `ClassesScreen.tsx` importe déjà `import type { SchoolClass } from "../data/catalog"` sur `develop` ; ligne inchangée ici |
| `test:parite-scolarite-l0` | échec | échec | `AssertionError: fiche élève = destination, pas une liste à replier` (`expected: /ExpandableEntityCard/`) | `StudentDetailScreen.tsx` (non touché) |
| `verify:parite-l0-l1-red` | échec | échec | `FAIL verify 22/22:` | lot de tests RED de parité. Il réécrit `docs/audits/evidence/parite-l0-l1-red-verify.json`, remis à l'état de `develop` (non inclus dans le diff) |
| `test:student-card-nfc-integration` | échec | échec | `not ok 1 … error: 'SOMAFRIK_NFC_TEST_DATABASE_URL is mandatory; no silent skip'` | base PostgreSQL NFC dédiée absente de la session |
| `test:student-card-class-roll-call-integration` | échec | échec | même message (`SOMAFRIK_NFC_TEST_DATABASE_URL`) | idem |
| `test:student-card-entry-control-integration` | échec | échec | même message (`SOMAFRIK_NFC_TEST_DATABASE_URL`) | idem |

Non exécutés :
- tests Android sur appareil (aucun appareil ni émulateur dans la session de travail) ;
- build iOS ;
- smoke natif SQLCipher (`verify:mobile-l1-native-sqlcipher-smoke`).

## 9. Benchmark (temps **simulé**)

Commande :

```bash
npm --prefix Mobile run bench:l1-perf-pr5
```

Le banc utilise le vrai lecteur L1, le vrai store mémoire L1 et le vrai coordinateur, avec des minuteurs factices `node:test` (pas de 10 ms). « Avant » = modèle du code historique (repli sur `NETWORK_UNAVAILABLE` seul, sans cache-first ni déduplication). Ce ne sont **pas** des mesures sur appareil Android.

| Scénario | Copie affichée (avant / après) | Données fraîches (avant / après) | Requêtes (avant / après) | Écran vide malgré une copie autorisée (avant / après) |
|---|---|---|---|---|
| Ouverture sans cache, réseau 300 ms | — / — | 300 / 300 ms | 1 / 1 | non / non |
| Ouverture avec cache, réseau 300 ms | — / **≤ 10 ms** | 300 / 300 ms | 1 / 1 | non / non |
| Forte latence, réseau 3 000 ms | — / **≤ 10 ms** | 3 000 / 3 000 ms | 1 / 1 | non / non |
| Délai de 20 s, avec cache | — / **≤ 10 ms** | — / — | 1 / 1 | **oui / non** |
| Délai de 20 s, sans cache | — / — | — / — | 1 / 1 | non / non (pas de copie) |
| Retour rapide entre écrans (3 visites en 20 s) | — | — | 3 / **1** (2 sautées) | — |
| Lectures simultanées (4 composants) | — | — | 4 / **1** (3 dédupliquées) | — |
| Reconnexion après interruption | copie ≤ 10 ms pendant le délai | 300 ms à la reprise | 2 | non |
| Changement d'établissement (B, réseau en délai) | **aucune** copie de A | — | 1 | non (aucune copie autorisée pour B) |

## 10. Risques résiduels

- **Ancien fichier commun :** `somafrik-l1-v1.db` et sa clé restent sur les appareils déjà installés. Ils ne sont plus jamais ouverts, et leur suppression physique reste à décider (hors périmètre, aucune purge destructive ici).
- **Premier lancement après mise à jour :** cache vide, donc une synchronisation L1 complète au premier démarrage en ligne. Hors ligne avant cette synchronisation, l'écran affiche « Cache hors ligne indisponible ».
- **Session et instantané de droits :** ils restent stockés sous des clés communes à tous les environnements (hors L1, hors périmètre). Ils sont neutralisés par le 401 en ligne et par la partition absente hors ligne (§7 bis).
- **Cache-first :** l'affichage précède la confirmation réseau. Les droits sont ceux établis par le serveur pour la session (`ready` ou `ready_offline`). Une révocation survenue depuis n'est connue qu'au 403 suivant, qui retire alors la copie. Fenêtre maximale : la durée de la requête.
- **Retour d'écran :** les retours d'écran de Planning, Enseignants et Structure pédagogique restent forcés : leurs fonctions servent aussi après des mutations. Le gain de 30 s n'y est pas appliqué.
- **Fraîcheur réseau :** la fraîcheur de 30 s ne s'applique qu'aux retours d'écran. Une donnée modifiée par un autre utilisateur dans cet intervalle apparaît au retour suivant ou au rafraîchissement manuel.
- **Indication de fraîcheur :** elle ne couvre que les 4 écrans qui affichaient déjà un bandeau L1. Les autres écrans lisant ces ressources montrent les données sans libellé.
- **Mesures :** aucune sur appareil réel. Le temps d'ouverture de SQLCipher sur un Android d'entrée de gamme n'est pas mesuré.

## 11. Hors périmètre

- Backend, Web, RBAC serveur, abonnements, bulletins, finance, notes, Carte Élève (NFC/QR), Agent IA, Render, `main`, règles GitHub : **non modifiés**.
- Schéma L1, chiffrement, purge, outbox : **non modifiés**.
- Aucune dépendance ajoutée.
- PERF-PR6 : non commencé.
