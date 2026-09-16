# Audit DEMO-DATA — payload réel (seed PostgreSQL → API → scope Web)

Mandat CTO **#669 commentaire `5690016482`**. Référence terrain : `#669` HEAD `6b874c025b21d5f25b013bd990c4773fef148c33`.

**#669 reste Draft / HOLD.** Cette PR d’audit ne corrige pas les spinners et n’assouplit pas `schoolId`.

Gate local GREEN-on-RED : `npm run verify:demo-web-payload-scope` (PostgreSQL 16 isolé, seed `seed-platform-bulk.js --fresh`).

Artifact : `docs/audits/evidence/demo-web-payload-scope.json`.

## Session mesurée (chemin terrain Démo)

`demoGateway` appelle `POST /api/login` (`role=school_admin`, `schoolCode=CD-IN-26-001`, `identifier=admin`, pin interne).

| champ | valeur mesurée |
|---|---|
| `POST /api/login` `admin` / `CD-IN-26-001` | **401** « Identifiant ou mot de passe incorrect. » |
| identifiant PG qui aboutit | `ADMIN-SCH-BULK-CD-0001-01` (user_code, pas `admin`) |
| `session.user.schoolId` | **∅** |
| `session.user.schoolPublicCode` | **∅** |
| `session.user.schoolCode` | `SCH-BULK-CD-0001` |
| JWT `schoolCode` | `SCH-BULK-CD-0001` |
| JWT `schoolId` | **∅** |
| `schoolContext.id` | UUID `1634bde4-…` (présent sur l’objet école, **pas copié sur `user`**) |
| `schoolContext.loginCode` | `CD-IN-26-001` |
| `activeSchoolCode` | `SCH-BULK-CD-0001` |

`buildManagedMobileUser` (`/api/login`) n’attache ni `schoolId` ni `schoolPublicCode`. `attachCanonicalSchoolIdentity` n’existe que sur `/backoffice/login`. Le Web Démo (`DemoRuntimeEntryPage`) pose `session.user` tel quel.

Le seed imprime encore « Admin école démo : admin (CD-IN-26-001) », mais `insertUsers` persiste `publicId` comme `user_code` et `getUserIdentifier` n’a pas d’alias `ADMIN-SCH-BULK-CD-0001-01` → `admin`. **Pas de réécriture du seed dans cette PR.** Si Render a une session valide avec `identifier=admin`, l’alias n’est pas celui du bulk PG de ce commit.

## Tableau HTTP → raw → mapped → scoped

| domaine | HTTP | raw PG | mapped API | scoped Web | 1er drop | identité 1er row API |
|---|---:|---:|---:|---:|---|---|
| schools | 200 | 3 | 1 | 1 | — | schoolId=∅ schoolCode=`SCH-BULK-CD-0001` public=`CD-IN-26-001` |
| users | 200 | 430 | 430 | **0** | **scoped** | schoolId=UUID schoolCode=`CD-IN-26-001` public=`CD-IN-26-001` (`MISSING_CANONICAL_IDENTITY`) |
| students | 200 | 300 | 300 | **0** | **scoped** | schoolId=UUID schoolCode=`CD-IN-26-001` public=matricule (`MISSING_CANONICAL_IDENTITY`) |
| classes | 200 | 30 | 30 | 30 | — | schoolId=∅ schoolCode=`SCH-BULK-CD-0001` public=∅ |
| teachers | 200 | 59 | 59 | 59 | — | schoolId=∅ schoolCode=`SCH-BULK-CD-0001` public=∅ |
| notes | 200 | 2400 | 2400 | 2400 | — | schoolId=UUID schoolCode=`SCH-BULK-CD-0001` public=∅ |
| evaluations | 200 | 0 | 0 | 0 | — | ∅ (pas de volume seed) |
| presences | 200 | 300 | 300 | **0** | **scoped** | schoolId=UUID schoolCode=`CD-IN-26-001` public=∅ |
| payments | 200 | 300 | 300 | **0** | **scoped** | schoolId=∅ schoolCode=`CD-IN-26-001` public=∅ |
| assignments | 200 | 59 | 59 | 59 | — | schoolId=∅ schoolCode=`SCH-BULK-CD-0001` public=∅ |
| courseSchedules | 200 | 1200 | **0** | 0 | **mapped** | ∅ (HTTP 200, payload non unwrap en liste) |

RED minimal **reproduit** : `students.raw = 300` et `projectScopedStudents.kept = 0` (`MISSING_CANONICAL_IDENTITY`).

`classes.raw = 30` et `scopedClasses = 30` : **ce gate ne vide pas les classes au scoper `schoolCode`**.

## Où le volume passe de >0 à 0

### 1. Élèves / comptes — drop `scoped` (cause principale mesurée)

- API : 300 élèves / 430 users, **tous** avec `schoolId` = UUID établissement.
- Session `/api/login` : **`user.schoolId` absent**.
- `resolveSessionSchoolIdentity` fail-closed → `MISSING_CANONICAL_IDENTITY` → `kept = 0`.
- L’UUID existe pourtant sur `schoolContext.id` et sur les rows. Il n’est pas sur `session.user`.

Cela explique directement : Élèves vides/chargement, Comptes utilisateurs vides, KPI Vue d’ensemble bloqués sur un snapshot `students=[]`.

### 2. Présences / paiements — drop `scoped` (secondaire, même fracture d’identité)

- Rows API projetées en **`schoolCode = CD-IN-26-001`** (login_code).
- Session / JWT : **`schoolCode = SCH-BULK-CD-0001`**.
- `scopedPresences` / `scopedPayments` comparent `row.schoolCode` à `session.schoolCode` **et** aux élèves scopés. Élèves déjà à 0 → pas de jointure `studentId`. Égalité de code fausse → **0**.

`notes` restent à 2400 parce que `GET /notes` porte encore `schoolCode = SCH-BULK-CD-0001` (égalité avec la session). Le spinner Notes terrain n’est donc **pas** un `scopedNotes=0` dans ce gate.

### 3. Classes / enseignants / affectations — pas de drop scoped

`GET /classes` et `GET /teachers` portent `schoolCode = SCH-BULK-CD-0001`, aligné sur le JWT. `scopedClasses` / `scopedTeachers` conservent le volume.

Le message terrain « Aucune classe dans votre périmètre » **n’est pas** `scopedClasses=0` sur ce chemin. Pistes adjacentes non transformées en conclusion :

- `/planning` : `courseSchedules` mapped=0 (forme de payload, pas unwrap `items`/`rows`) alors que PG a 1200 ;
- `user_roles` PG = **0** après seed (backfill exécuté au `init` avant insert users) — ici les GET métier ont quand même répondu 200.

### 4. Identités simultanées (hypothèse CTO, maintenant mesurée)

| identité | PG école | JWT / `user` | row students/users API | row classes/teachers API |
|---|---|---|---|---|
| UUID `schoolId` | oui | **absent** | oui | souvent absent |
| `CD-IN-26-001` | `login_code` | seulement `schoolContext.loginCode` | `schoolCode` projeté | non |
| `SCH-BULK-CD-0001` | `school_code` | `user.schoolCode` + JWT | brut PG avant projection | `schoolCode` |

## Hors périmètre (respecté)

- pas de fallback permissif
- pas de bypass `schoolId`
- pas de changement PROD/PREPROD
- pas de réécriture du seed
- pas de nouvelle logique de spinner
- **#669 non redéployée, non modifiée**
