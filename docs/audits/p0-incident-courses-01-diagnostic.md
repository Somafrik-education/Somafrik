# P0-INCIDENT-COURSES-01 — Diagnostic / HOLD

**Statut :** diagnostic live confirmé / réparation A1 **candidate** / #531 **interdit** jusqu’à autorisation CTO / #894 DRAFT-HOLD  
**Date :** 2026-10-11  
**Cible code :** `main@ef8bc951` (identique pour le fail-closed `school_courses` sur `develop`)  
**PII :** aucun identifiant élève, nom, e-mail ou UUID live dans ce document. Code établissement seulement.

---

## 1. Cause racine exacte (code)

Le backend refuse de démarrer parce que `PostgresRepository.init()` appelle
`ensureTeacherCourseCanonicalReconcile()` après le schéma pédagogie. Cette
réconciliation parcourt **chaque** `teacher_assignment` active et **s’arrête**
dès qu’un `school_course` actif existe déjà pour la même classe+matière sans
être déjà lié au même `teacher_id`.

Message observé (branche B, pas les références non canoniques) :

```text
Échec initialisation PostgreSQL:
Plusieurs school_courses actifs ou collision classe+matière
— aucun choix silencieux.

Code domaine: CANONICAL_SCHOOL_COURSE_AMBIGUOUS
```

| Étape boot | Résultat attendu d’après le contrat |
| --- | --- |
| Connexion PostgreSQL | OK (le contrôle lit déjà les tables) |
| Unicité enseignants / affectations / login | OK (sinon un autre code domaine sortirait avant) |
| `ensurePedagogyCanonicalSchema()` | OK — sinon l’erreur serait une création d’index, pas `CANONICAL_SCHOOL_COURSE_AMBIGUOUS` |
| `ensureTeacherCourseCanonicalReconcile()` | **STOP** |

Émetteur exact :

1. `decideSchoolCourseMaterialization()` dans `backend/lib/teacherCourseCanonicalReconcile.js`
2. levée par `materializeSchoolCoursesFromAssignments()`
3. journalisée par `backend/db/repositoryFactory.js` (`Échec initialisation PostgreSQL` + `Code domaine`)

Règle canonique (inchangée, volontairement fail-closed) :

| `school_courses` actifs `(school, classe, matière, enseignant)` | `school_courses` actifs `(school, classe, matière)` | Décision |
| --- | --- | --- |
| 0 | 0 | `INSERT` d’un cours |
| 1 | ≥1 (le même) | no-op |
| >1 | — | **STOP** |
| 0 | ≥1 (autre `teacher_id` **ou NULL**) | **STOP** |

`NULL IS DISTINCT FROM <uuid>` est vrai : un cours sans enseignant face à une
affectation est une collision boot, pas un bind silencieux.

---

## 2. Fichiers et commits responsables

| Élément | SHA | Date | Rôle |
| --- | --- | --- | --- |
| Introduction du fail-closed boot | `046e6689` / PR **#265** | 2026-08-19 | `ensureTeacherCourseCanonicalReconcile` |
| Index unique actif classe+matière | `backend/db/migrations/20260813_pedagogy_canonical.sql` + `pedagogySchema.js` | LOT 5 | `uq_school_courses_class_subject_active` |
| Inventaire SELECT-only + repair SQL | `5273291e` / `020e442a` / PR **#531** | 2026-09-06 | tooling, **pas** de bind au boot |
| Write-path affectation → `teacher_id` | PR **#733** / #732 | 2026-09-20 | create/update/delete synchronisent le cours ; **« aucun auto-repair au boot »** |

Le fail-closed n’est **pas** un régressif des déploiements dashboard #818–#827.
Un redéploiement identique relance le même `init()` et reproduira le STOP.

---

## 3. Production vs préproduction

| Contrôle | Production (`main` / `api.somafrik.app`) | Préproduction (`develop` / `somafrik-api-preprod`) |
| --- | --- | --- |
| Code fail-closed `teacherCourseCanonicalReconcile.js` | présent | **identique** (diff vide) |
| Health `GET /api/health` (2026-10-10) | **HTTP 502** Render `dynamic-paid-error` | **HTTP 502** Render `dynamic-paid-error` |
| Front | `somafrik.app` HTTP 200 | `preprod.somafrik.app` HTTP 200 |
| Inventaire PG live (cet agent) | **PENDING_LIVE_DB** — `DATABASE_URL` absent | **PENDING_LIVE_DB** — `PREPROD_DATABASE_URL` absent |

Le 502 externe confirme l’indisponibilité des API. Il ne remplace pas les logs
Render cités dans le mandat. Les deux environnements exécutent la même règle :
la différence éventuelle est **la donnée**, pas la détection.

Précédents déjà tranchés sur préprod (même code domaine) :

- 2026-08-27 : 1 cours `2ème A / Technologie`, `teacher_id = NULL`, 1 affectation
  canonique → bind ciblé du `teacher_id` (audit mobile RC2).
- 2026-09-06 (#531) : 0 doublon actif ; 1 cours `teacher_id = NULL` ; repair SQL.
- 2026-09-20 (#733) : 2 cours créés sans enseignant puis affectations → même repair.

---

## 4. Collisions live — PENDING_LIVE_DB

Cet agent n’a **aucun** secret PostgreSQL. Aucun SELECT production n’a été
exécuté. Compteurs ci-dessous = non mesurés.

| Métrique | Valeur publiable |
| --- | --- |
| Nombre de collisions | **PENDING_LIVE_DB** |
| Établissements concernés | **PENDING_LIVE_DB** (codes seulement, jamais de noms de personnes) |
| Cours / classes / matières | **PENDING_LIVE_DB** |
| Dépendances (affectations, notes, bulletins, planning) | **PENDING_LIVE_DB** |

Commande obligatoire, **hors dépôt**, transaction read-only :

```bash
# Production — SELECT only. Interdit : --apply / --write / --fix / --delete
PROOF_OUT=/tmp/school-course-ambiguity-prod.json \
DATABASE_URL='<secret ops, jamais git>' \
npm run inventory:school-course-ambiguity

# Préproduction (comparaison)
PROOF_OUT=/tmp/school-course-ambiguity-preprod.json \
PREPROD_DATABASE_URL='<secret ops, jamais git>' \
npm run inventory:school-course-ambiguity
```

Le JSON expose désormais un `summary` (compteurs + `collisionKindCounts`)
sans qu’il soit nécessaire de coller des UUID dans GitHub.

---

## 5. Lecture : donnée réelle, migration incomplète, ou défaut de détection ?

Preuve **code** (pas encore preuve live) :

1. Si le boot a atteint `CANONICAL_SCHOOL_COURSE_AMBIGUOUS`, le schéma pédagogie
   a réussi. `CREATE UNIQUE INDEX uq_school_courses_class_subject_active` aurait
   échoué s’il existait déjà deux lignes `status='active'` pour la même
   classe+matière. Donc le cas « plusieurs cours actifs » est **improbable**
   tant que l’index est présent.
2. Le message cité est celui de `matchingByClassSubject.length > 0` alors que
   `matchingByTeacher.length === 0` : un cours actif classe+matière dont le
   `teacher_id` n’est **pas** celui de l’affectation (y compris `NULL`).
3. Ce n’est **pas** un faux positif de libellés : la règle ne matche que des UUID.
4. Ce n’est **pas** Puppeteer.

Hypothèse **prioritaire** (récidive #531 / #733), à confirmer par l’inventaire :

> `school_courses.teacher_id IS NULL` + exactement une `teacher_assignment`
> active canonique pour la même classe+matière.

Hypothèses alternatives, même code domaine :

- affectation vs cours déjà lié à **un autre** enseignant → conflit métier,
  `needs_human` ;
- affectation aux FK non canoniques → autre message (« références non
  canoniques ») ; écarté si le log est bien celui cité ;
- index unique **absent** + vrais doublons actifs → `duplicateGroups > 0`.

**Option B (corriger la détection) : non retenue sans preuve live.**
Le write-path (#733) bind déjà `NULL → teacher` sur create d’affectation.
Le boot refuse volontairement ce bind (« aucun auto-repair au boot »).
Assouplir le boot serait un choix silencieux, interdit par le contrat.

---

## 6. Risques pour les données scolaires

| Action | Risque |
| --- | --- |
| DELETE / TRUNCATE / purge | Perte notes, bulletins, planning, affectations |
| Désactiver le fail-closed | Sélection arbitraire d’un cours au prochain boot |
| Fusionner deux `school_course` | Recâblage silencieux des FK planning |
| Bind `teacher_id` si 0 ou >1 affectation | Attribution incorrecte d’un cours |
| Bind `teacher_id` si un autre enseignant est déjà porté | Écrasement métier |
| Archivage d’un doublon avec créneaux / notes | Planning ou historique orphelin |

Les notes (`grades` / `evaluations`) et bulletins (`report_cards`) ne portent
**pas** de FK `school_course_id` : ils s’alignent sur `(classe, matière[, enseignant])`.
Un mauvais `teacher_id` sur le cours ne les efface pas, mais fausse Planning et
le sélecteur de cours.

---

## 7. Solutions (applicables seulement après inventaire)

### Option A — Correction contrôlée des données (recommandée *si* l’inventaire colle)

**A1 — `teacher_id NULL` + 1 affectation canonique** (`summary.nullTeacherRepairableCount` > 0,
`other_teacher = 0`, `duplicateGroupCount = 0`) :

1. Sauvegarde PostgreSQL production **vérifiée** (restore test).
2. `BEGIN;` puis le SQL déjà versionné
   `backend/db/repair_school_course_teacher_from_assignment.sql`.
3. Contrôle du `RETURNING` (nombre = inventaire dry-run).
4. Relancer l’inventaire : `blocksBoot=false`.
5. `COMMIT;` uniquement après validation CTO. Sinon `ROLLBACK;`.
6. Redémarrer `Somafrik-api-prod` **sans** nouveau merge.

Réversible : `UPDATE school_courses SET teacher_id = NULL WHERE id IN (…)`.

**A2 — Vrais doublons actifs, gagnant unique démontré**
(`proposal.autoArchiveIds`, `needsHuman=false`) : archivage réversible
`schoolCourseAmbiguityRepair` — pas un DELETE.

**A3 — Autre enseignant / refs non canoniques** : `needs_human`. Aucun SQL
automatique. Décision métier établissement par établissement.

### Option B — Correction de la détection

Uniquement si l’inventaire prouve que des collisions **valides** sont
signalées à tort (ex. deux enseignants légitimes pour la même classe+matière
alors que le contrat métier les autorise). **Aucune preuve à ce jour.**
Interdit : relâcher le fail-closed pour « débloquer » le boot.

---

## 8. Plan de restauration

1. **Freeze** déploiements production (déjà recommandé).
2. Ops : inventaire SELECT-only prod **et** préprod (`PROOF_OUT` hors git).
3. Diff CTO des `summary` (kinds + compteurs de dépendances).
4. Si A1 : backup → repair SQL #531 sous transaction → inventaire post → reboot.
5. Si A3 : pas de reboot tant que le conflit métier n’est pas tranché.
6. Pas de merge, pas de Ready, pas de reset de base.

---

## 9. Tests nécessaires

```bash
npm run verify:school-course-ambiguity-inventory
npm run verify:teacher-course-canonical-reconcile
```

Non-régression obligatoire : collision classe+matière → toujours STOP au boot.
Le repair `teacher_id NULL` reste **hors** `init()`.

Après une éventuelle Option A validée CTO : relancer l’inventaire live puis
`GET /api/health` → `database=postgresql`.

---

## 10. PR

**Oui — DRAFT / HOLD uniquement.** Cette PR :

- documente le diagnostic ;
- étend l’inventaire SELECT-only (kinds `teacher_id NULL`, compteurs notes /
  bulletins / planning) ;
- **ne change pas** `decideSchoolCourseMaterialization` ;
- **n’exécute pas** le repair au boot ;
- **n’autorise aucune écriture production**.

Diff CTO indépendant requis avant tout Ready.

---

## 11. Verdict CTO 2026-10-10 — Render lecture seule + CI

**Merge #894 toujours interdit.** Repair SQL #531 **non autorisé** tant que
l’inventaire live n’a pas départagé `null_teacher_repairable` / `other_teacher`
/ doublons.

### Render workspace `somafrik` — lecture seule : OUI

Autorisé maintenant :

- lister les services Production / Préproduction et leurs bases attachées ;
- lire déploiements, logs de boot, noms de variables (pas les valeurs) ;
- ouvrir PostgreSQL en `BEGIN READ ONLY` / `npm run inventory:school-course-ambiguity` ;
- coller uniquement le bloc `summary` (compteurs, `schoolCodes`, kinds) hors PII.

Interdit à cette étape : redéploiement, restart « pour voir », changement d’env,
SQL d’écriture, repair #531, DELETE / UPDATE / TRUNCATE, collage de
`DATABASE_URL`, mots de passe, UUID élèves, noms ou e-mails dans GitHub.

L’agent Cursor de #894 **n’a pas** le connecteur Render dans son catalogue
d’outils. L’inventaire live doit être exécuté depuis le connecteur CTO / ops.

Ordre : confirmer services → inventaire prod **puis** préprod (séparés) →
lire `nullTeacherRepairableCount`, `other_teacher`, doublons, dépendances →
choisir A1 / A2 / A3. Pas de procédure avant ces chiffres.

### Isolation CI #894 (run `38095972585`) — hors diff incident

Aucun de ces échecs ne vient du fail-closed ni de l’inventaire ajouté.
Ne pas désactiver les gates. Ne pas merger. Corriger **ailleurs** que sur
cette PR HOLD.

| Job | Premier échec exact | Attribuable à #894 ? |
| --- | --- | --- |
| Secrets | `gitleaks detect --source .` (historique, `fetch-depth: 0`) trouve `generic-api-key` dans `e304aaa7:backend/lib/studentCardCapability.test.js:16` | **Non.** `e304aaa7` n’est pas ancêtre de `d668fe2a`. Fixture de test `const SECRET = "abcdefghijklmnopqrstuvwxyz012345"` (alphabet+chiffres, pas une clé live). Déjà retiré sur develop par `e2e3aeff` (`opaquePart`). |
| Risk-targeted | Premier stop : `verify:planning-v2-weekly` login mémoire `403 !== 200` — abonnement démo `endDate=31-08-2026` expiré au 10-10-2026. **Pas** de `23P01` / contrainte d’exclusion dans ce run | **Non.** Dette seed/horloge déjà sur `main@ef8bc951`. Le chemin `*course*` active le lot Planning. |
| Core tests | `verify:jwt-header` : même 403 abonnement expiré | **Non.** |
| LOT 1 parity | `educationSchoolCatalog.http.test.js` PARITY-037 : même 403 | **Non.** |
| Required | Agrège les quatre échecs ci-dessus | **Non.** |

La contrainte d’exclusion `course_schedule_weekly_slots` **n’apparaît pas**
dans les logs failed de ce run : le job Planning s’arrête avant, sur le login.
Ne pas lui attribuer #894.

Correctifs CI à ouvrir **séparément** (pas sur #894) : (1) allowlist / rewrite
historique gitleaks du fixture carte, déjà fait sur develop ; (2) dates
d’abonnement des seeds mémoire au-delà du calendrier CI.

---

## 12. Audit Render 2026-10-10 — où est PostgreSQL production ?

Relevé CTO (lecture seule, aucun secret) : `Somafrik-api-prod` / `main@ef8bc951`
échoue au boot (`CANONICAL_SCHOOL_COURSE_AMBIGUOUS`, 10 oct. 23:44 UTC).
`somafrik-api-preprod` / `develop@7a294471` a démarré (`Base active: postgresql`).
Render ne liste qu’une instance PG gérée : `somafrik-demo-db`.

**Réponse documentée (pas un secret) :** la base métier de production n’est
**pas** Render Postgres. Elle est sur **Supabase**.

| Environnement | Hébergeur PG documenté | Preuve git | Ce que Render montre |
| --- | --- | --- | --- |
| Production | **Supabase** projet `Somafrik-prod` (`loyubruyrxcaeshonkwp`), AWS **eu-west-1** (Irlande), Postgres 17.6.1 | `docs/compliance/preuves-transferts-2026-09-05.md` (5 sept. 2026, `ACTIVE_HEALTHY`) | API seulement (`Somafrik-api-prod`). Pas d’instance PG gérée prod. |
| Préproduction | Supabase Session pooler **ou** Postgres externe via `DATABASE_URL` du service | `.env.preproduction.example` (hôte `aws-0-REGION.pooler.supabase.com`) | API `somafrik-api-preprod`. Pas d’instance PG gérée préprod. |
| Démo | Render Postgres `somafrik-demo-db` / base `somafrik_demo` | `docs/demo/ENVIRONMENT-1-DATABASE.md` | **Seule** instance PG gérée visible — hors prod/préprod. |

`somafrik-demo-db` est l’environnement Démo (#661). L’interroger pour cet
incident serait une cible fausse (et un risque de reset démo, hors mandat).

Confirmation live **sans coller l’URL** : dans le dashboard Render du service
`Somafrik-api-prod`, relever **uniquement** le hostname de `DATABASE_URL`
(`new URL(DATABASE_URL).hostname`). Attendu si inchangé depuis le 5 sept. :

- `aws-0-eu-west-1.pooler.supabase.com` (pooler), ou
- `db.loyubruyrxcaeshonkwp.supabase.co` (direct)

Puis inventaire depuis le SQL editor **Supabase** `Somafrik-prod` (rôle
lecture seule, `BEGIN READ ONLY`), pas depuis les instances Render Postgres.

Préprod a booté le 10 oct. : collision actuelle = **donnée production**, pas
un défaut de détection présent aussi sur `develop`.

---

## 13. Inventaire live CTO 2026-10-11 — A1 candidate, #531 encore interdit

Supabase `ACTIVE_HEALTHY` des deux côtés. L’incident est l’init API, pas une
panne plateforme. Requêtes CTO en `BEGIN READ ONLY`. Aucune écriture.

```json
{
  "environment": "production",
  "project": "Somafrik-prod",
  "summary": {
    "schoolCount": 1,
    "schoolCodes": ["SCH-A3A33AC861644EE5A967"],
    "collisionKinds": {
      "null_teacher_repairable": 2,
      "other_teacher": 0,
      "duplicate_active": 0
    },
    "candidateGroups": 2,
    "dependencyTotals": {
      "weeklyPlanning": 0,
      "datedPlanning": 0,
      "evaluations": 0,
      "grades": 0,
      "reportCards": 0
    }
  },
  "preproduction": { "detectedCollisions": 0 },
  "repairExecuted": false
}
```

Deux combinaisons classe+matière distinctes, chacune : 1 cours actif,
`teacher_id NULL`, 1 affectation active, 1 enseignant. Option B écartée
(détection conforme). Option A1 = candidate privilégiée.

### Préconditions #531 encore à dry-runer (SELECT)

Le premier inventaire ciblé ne remplace pas le CTE exact du repair.
Fichier : `backend/db/dry_run_repair_school_course_teacher_from_assignment.sql`

`BEGIN READ ONLY` sur `Somafrik-prod` puis `ROLLBACK`. Attendu : **2 lignes**,
`current_teacher_id` NULL, `proposed_teacher_id` non NULL, 2 `class_id` /
`subject_id` distincts. Préprod : **0 ligne**.

Le CTE exige en plus (à confirmer par ce dry-run, pas seulement par COUNT) :

- `teachers.status` hors `deleted` / `archived`
- `teachers.school_id` = affectation
- `classes.academic_year_id` = `teacher_assignments.academic_year_id`
- `subjects` / `academic_years` même `school_id`
- `COUNT(*) OVER (PARTITION BY sc.id) = 1` (fenêtre du repair, pas un COUNT
  métier approximatif)

Si le dry-run renvoie ≠ 2, **ne pas** appliquer le UPDATE.

### Plan A1 — uniquement après autorisation CTO explicite

1. Sauvegarde Supabase `Somafrik-prod` **vérifiée** (restore test ou PITR
   point noté).
2. Dry-run ci-dessus = 2.
3. `BEGIN;` + `repair_school_course_teacher_from_assignment.sql`.
4. `RETURNING` : 2 lignes, `teacher_id` non NULL, mêmes `id` que le dry-run.
5. Relancer l’inventaire / dry-run : 0 collision, 0 repairable.
6. Validation CTO de la transaction → `COMMIT;` sinon `ROLLBACK;`.
7. Restart **uniquement** du process `Somafrik-api-prod` (même SHA
   `ef8bc951`, pas de nouveau merge). Health `database=postgresql`.

Retour arrière (après COMMIT, IDs issus du `RETURNING`, jamais inventés) :

```sql
BEGIN;
UPDATE school_courses
   SET teacher_id = NULL, updated_at = NOW()
 WHERE id = ANY($1::uuid[])
   AND status = 'active'
   AND teacher_id IS NOT NULL
RETURNING id, teacher_id, status;
-- COMMIT ou ROLLBACK après contrôle
```

**#531 UPDATE toujours interdit** jusqu’à autorisation écrite. #894 reste
DRAFT / HOLD. Aucun merge, aucun redéploiement, aucun changement d’env.
