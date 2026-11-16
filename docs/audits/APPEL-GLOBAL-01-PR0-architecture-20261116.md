# APPEL-GLOBAL-01 — PR0 audit d'architecture (DRAFT / HOLD)

Date : 2026-11-16  
Issue : https://github.com/Somafrik-education/Somafrik/issues/1163  
Base de l'audit : `develop@b925ba9a1d58eb099dc62c8277fb4a9ddaa21e68`  
Statut : **AUDIT INITIAL — OPTIONS NON TRANCHÉES — AUCUN GO PRODUIT**

## 1. Besoin constaté par recette Android

La capture « Présences » montre un bouton `Démarrer l'appel NFC/QR` hors de toute classe. Son appui ouvre `Choisir la classe de l'appel`. Le besoin métier réel est différent : **Directeur et Secrétaire** doivent lancer une **session de scan établissement** sans choisir de classe et scanner successivement des élèves de classes différentes. Le terminal retrouve automatiquement la classe de chaque carte. Les enseignants conservent leur périmètre de classes affectées.

La PR #1161 (mergée) règle uniquement le cas « classe déjà ouverte → pas de deuxième choix ». Elle n'implémente pas l'appel global.

## 2. Cartographie de l'existant vérifiée

| Fichier | Contrat vérifié | Conséquence |
| --- | --- | --- |
| `Mobile/src/screens/TeacherAttendanceScreen.tsx` | lancement sans classe → sélecteur | route UX à séparer par droit global |
| `Mobile/src/components/RollCallClassPickerModal.tsx` | liste autorisée par identité | conserver comme parcours enseignant/classe |
| `Mobile/src/components/OfflineRollCallModal.tsx` | props `classId`, `date` ; reprise `findLatestSession(ctx,classId,date)` | moteur non global |
| `Mobile/src/offline/rollCall/session/offlineRollCall.ts` | `openOfflineRollCall` et `processCard` opèrent sur une session / pack de classe | ne pas injecter plusieurs classes dans une session |
| `Mobile/src/offline/rollCall/pack/verifyPack.ts` | pack signé lié à `schoolId`, `actorUserId`, `classId`, `date`; carte reconnue avec `computeCardRef` incluant la classe | la classe ne peut pas être déduite d'un simple `publicId` non vérifié |
| `backend/lib/rollCallOfflinePack.js` | endpoint pack avec `classId` obligatoire | précharger les classes ou versionner un contrat global |
| `backend/lib/rollCallOfflineSync.js` | lot par `classId` ; preuves HMAC et idempotence | conserver des lots unitaires par classe de préférence |
| `Mobile/src/offline/rollCall/runtime/rollCallRuntime.ts` | stockage compte / établissement et barrières de déconnexion | préserver le cloisonnement |
| `Mobile/src/lib/rollCallLauncher.ts` | permission dédiée `canStartRollCall` | distinguer permission d'appel et permission d'appel global |

## 3. Proposition initiale à éprouver par tests : agrégateur de packs vérifiés par classe

1. Le mobile obtient les classes **autorisées** pour le compte ; Directeur et Secrétaire peuvent viser l'ensemble de l'établissement **si** les droits RBAC effectifs le permettent. Un rôle Enseignant sans droit global conserve ses affectations.
2. Télécharger et vérifier les packs signés **séparément** par classe/date/compte/école. La préparation doit être bornée par la mémoire, le nombre de classes et les dates de validité.
3. Après lecture d'une carte, essayer une recherche locale parmi les packs **vérifiés**. Une correspondance unique vérifiée permet d'identifier la classe ; zéro = à vérifier (sans fausse attribution), plusieurs = ambigu, sans écriture automatique.
4. Pour une correspondance unique : ouvrir/reprendre le brouillon de **cette classe** et y enregistrer avec le `classId` et le `packId` exacts ; aucun HTTP par lecture.
5. Agréger pour l'UX les compteurs par élève et par classe **après COMMIT** ; les doublons ne doivent pas gonfler le nombre de présents.
6. Clôturer explicitement les brouillons par classe ; synchroniser avec l'endpoint existant **par classe** si les tests de conformité le confirment. Une défaillance d'une classe ne doit pas annuler ni dupliquer les autres.

**Points non prouvés à la PR0 :** performance sur plusieurs centaines de classes, limites des packs, comportement des cartes hors packs, sécurité lors du changement d'identité, conflit de présence déjà enregistrée côté serveur, et mode « établissement » si aucun pack vérifié n'est disponible. Ces points doivent recevoir des décisions explicites avant PR1. Aucun algorithme de routage ne doit se baser sur un identifiant de carte seul.

## 4. Alternative à évaluer

Pack signé **établissement** (contrat v2) avec index pseudonymisé carte→classe, mais il exige un nouveau contrat backend, une nouvelle signature, un contrôle anti-collision, une migration compatible v1 et une analyse du risque de divulgation. Ne pas introduire cette version sans démontrer pourquoi l'agrégateur de packs v1 ne suffit pas.

## 5. Modèle de menace et barrières

- **Tenant :** environnement/école/compte/date figés au lancement ; abandon des réponses en vol si la portée change ; ne jamais écrire dans le stockage d'un autre compte.
- **RBAC :** règle serveur explicite pour le droit « appel global » (Direction/Secrétariat avec permission effective), déni de l'enseignant non autorisé ; contrôle à la lecture *et* au sync.
- **Intégrité :** HMAC classe/session/pack/média conservé ; zéro secret, clé, UID ou jeton en logs ; un faux match ne crée aucune présence.
- **Offline :** n'utiliser que des packs signés utilisables et leurs contrôles de temps/révocation ; état dégradé explicite, pas de reconnaissance locale improvisée.
- **Idempotence :** double scan, deux cartes du même élève, retries, conflit d'un appel déjà clôturé, ACK perdu, appel partiel.
- **Absences :** aucune conversion automatique de « non pointé » en absent à la clôture.
- **Stockage :** SQLCipher par compte, conservation de brouillons, expiration et garde de déconnexion inchangées ; pas de copie JSON des données scolaires.
- **Régression :** garder le mode enseignant et la sélection de classe actuelle.

## 6. Contrats et tests exigés avant Ready PR0

- Matrice Directeur / Secrétaire / Enseignant / autre rôle, avec rôle multi-attribué et permission effective.
- Test pack multi-classes signé : bonne classe unique ; mauvaise école ; carte révoquée ; pack expiré ; double correspondance ; carte inconnue ; cache vide ; mode avion.
- Test stockage : 2 classes, 1 téléphone, 1 date, reprise après kill, changement d'identité, borne de taille, mémoire basse, transaction interrompue.
- Test PG/HTTP : 2 lots distincts avec carte et classe correctes, un lot refusé et l'autre accepté, double ACK, présence préexistante, cross-tenant 403, absence non confirmée.
- Recette Android réelle : sans sélection, scans alternés A→B→A, compteur par classe, compteurs établissement, coupure réseau, sync partielle, reprise.
- Chaque PR : diff GitHub indépendant avant Ready/Merge ; 5–8 gates ciblés (scope, secrets, lint, TS/build, unitaires, tests spécialisés, PG/HTTP).

## 7. Décisions et frontières de chantier

PR0 documentaire uniquement. Aucun changement API, SQL, Web, Mobile ou permissions ; aucun déploiement.  
Découpage prévisionnel : PR0 architecture → PR1 backend lecture → PR2 moteur mobile multi-classes → PR3 UX globale → PR4 sync/contrôle → PR5 smoke et preuves. Le découpage peut être ajusté uniquement après démonstration contractuelle.

### HOLD

Cette PR ne vaut ni validation technique finale du design ni autorisation d'implémenter un routage non sécurisé. Avant le merge de PR0, effectuer un **diff GitHub indépendant**, résoudre les questions ouvertes et recevoir un GO CTO explicite.
