# CARTE-CYCLE-01 — Titulaire de la carte (élève / étudiant)

Ce document décrit comment Somafrik détermine le titulaire d'une carte scolaire : **élève** ou **étudiant**. C'est ce titulaire qui fixera l'en-tête « CARTE D'ÉLÈVE » ou « CARTE D'ÉTUDIANT » de la future maquette (CARTE-UI-01). Il décrit aussi la garde qui interdit l'émission quand le titulaire ne peut pas être déterminé.

Décisions de référence : AUDIT-CARTE-UI-01 (#977) et décision CTO du 21-10-2026.

## Règle de détermination

Fonction pure : `resolveStudentCardHolder` (`backend/lib/studentCardHolder.js`). La règle s'applique dans cet ordre, et la première qui s'applique l'emporte.

| Ordre | Source | Valeur | `source` renvoyée |
|---|---|---|---|
| 1 | Surcharge du **niveau d'enseignement** de la classe courante de l'élève (`school_settings.student_card_holder_levels`) | `eleve` ou `etudiant` | `level_setting` |
| 2 | **Réglage explicite** de l'établissement (`school_settings.student_card_holder_kind`) | `eleve` ou `etudiant` | `school_setting` |
| 3 | **Type d'établissement exact** (`schools.school_type`) | voir la matrice ci-dessous | `school_type` |
| 4 | Aucune des sources précédentes | `null` (**non déterminé**) | `null` |

**Matrice des types d'établissement.** La comparaison est une égalité exacte, après normalisation Unicode NFC et suppression des espaces aux extrémités.

| `school_type` | Titulaire |
|---|---|
| `École primaire` | élève |
| `Collège` | élève |
| `Lycée` | élève |
| `Université` | étudiant |
| `Institut` | **non déterminé** : choix explicite requis |
| `Centre de formation` | **non déterminé** : choix explicite requis |
| Valeur libre ou héritée (`Établissement`, `Établissement secondaire`, `Démonstration`…), casse différente (`lycée`), type absent | **non déterminé** |

Aucune recherche approximative n'est faite dans un nom ou un libellé. Une valeur inattendue ne produit jamais de titulaire.

## Établissements mixtes

Un établissement est **mixte** dès qu'au moins une surcharge par niveau est enregistrée (`school_settings.student_card_holder_levels` non vide après lecture fail-closed).

- Une surcharge ne peut viser qu'un **niveau d'enseignement actif de l'établissement** (`school_levels`, `status = 'active'`). Sinon, la requête est refusée (`400 INVALID_STUDENT_CARD_HOLDER_LEVEL`), y compris pour un niveau activé seulement dans un autre établissement.
- Le niveau d'un élève est celui de sa classe courante (`classes.level_id`). La règle d'inscription est la même que pour la résolution de scan.
- **Fail-closed.** Dans un établissement mixte, le libellé n'est attribué que si le niveau de l'élève est **certain**. Il faut à la fois :
  - une seule classe courante ;
  - une classe qui a un `level_id` ;
  - un niveau toujours actif dans `school_levels` de cet établissement.

  Sinon, le titulaire est **non déterminé**, et ni le réglage global ni le type ne comblent l'incertitude :

| Situation (établissement mixte) | Résultat |
|---|---|
| Inscription courante absente (aucune, transférée, clôturée) | non déterminé, émission bloquée |
| Plusieurs classes courantes de niveaux différents (défensif : `UNIQUE (student_id, academic_year_id)` l'interdit déjà) | non déterminé |
| Classe sans niveau | non déterminé |
| Niveau désactivé ou retiré du référentiel après configuration (surcharge obsolète) | non déterminé : la surcharge n'a plus d'effet |
| Niveau d'un autre établissement, ou surcharge écrite pour un tel niveau | non déterminé, surcharge ignorée |
| Niveau actif surchargé | surcharge (`level_setting`) |
| Niveau actif sans surcharge, alors qu'une surcharge existe pour un autre niveau | réglage global, puis type exact, sinon non déterminé |
| Conflit entre le réglage global et une surcharge | la surcharge prime, pour ce niveau seulement |

- Une section non configurée ne reçoit jamais le libellé d'une autre section.
- Une réactivation du niveau rend de nouveau effective la surcharge enregistrée.

## Cohérence transactionnelle

- La validation des niveaux (`assertHolderLevelsActive`) s'exécute **dans la transaction d'écriture** de `school_settings`, avec le store transactionnel.
- Les niveaux actifs sont lus avec `FOR SHARE` (`listActiveSchoolLevelIds`). Une désactivation concurrente (`DELETE` ou `UPDATE` de `school_levels`) est donc soit vue avant la sauvegarde (refus 400), soit mise en attente jusqu'au `COMMIT`.
- Une désactivation **postérieure** à la sauvegarde est neutralisée à la lecture : `findCardHolderContext` renvoie `level_active`, et la résolution fail-closed bloque l'élève.

## Stockage et API

Le réglage passe par le mécanisme canonique des paramètres d'établissement. Il n'y a pas de système parallèle.

- **Table** `school_settings`, isolée par établissement (clé primaire `school_id`). Deux colonnes sont ajoutées par `backend/db/schoolSettingsSchema.js` (bootstrap idempotent), `backend/db/schema.sql` et `backend/db/migrations/20261021_school_settings_student_card_holder.sql` :
  - `student_card_holder_kind TEXT NULL`, avec `CHECK IN ('eleve','etudiant')`. `NULL` signifie non configuré.
  - `student_card_holder_levels JSONB NOT NULL DEFAULT '{}'`, avec `CHECK jsonb_typeof = 'object'`.
- **Aucune donnée existante n'est modifiée.** Les colonnes sont nullables ou ont une valeur par défaut, et aucune carte n'est touchée.
- **Routes existantes** `GET/PATCH /api/school-settings` et `/api/backoffice/establishments/:schoolCode/school-settings`. Les droits RBAC sont inchangés : modification avec `Paramètres Établissement:UPDATE`, `Gérer planning académique` ou `ALL_PRIVILEGES`.
  - `studentCardHolderKind` : `"eleve" | "etudiant" | null`.
  - `studentCardHolderLevels` : `{ "<education_levels.id>": "eleve" | "etudiant" }`. C'est un remplacement complet, limité à 64 entrées.
  - Lecture seule : `studentCardHolderFromSchoolType`, le titulaire déduit du type exact.
  - Toute modification est auditée (`update_school_settings`).
- **Route** `GET /api/students/:id/cards` : ajoute `holder: { kind, source }`, le titulaire résolu pour l'élève. Lecture seule, sans jeton.

## Sécurité d'émission

Quand le titulaire n'est pas déterminé :

- **Serveur** :
  - `POST /api/student-cards` (QR et QR + NFC) et `POST /api/student-cards/:id/replace` (sans puce) renvoient **`409 STUDENT_CARD_HOLDER_UNDETERMINED`**.
  - Le contrôle a lieu **avant toute génération de jeton** : aucune carte n'est créée, consommée ou modifiée, et aucun audit d'émission n'est écrit.
- **Web** :
  - « Émettre une carte » et « Remplacer » sont désactivés, avec un message qui renvoie vers les paramètres ;
  - « Déclarer perdue » et « Révoquer » restent disponibles, car ils ne génèrent aucun jeton.
- **Hors périmètre, inchangés** :
  - réservation et programmation NFC Mobile (`medium = nfc`), sans impression ;
  - contenu du QR, cycle de vie NFC, présence, paiements, transport ;
  - cartes déjà émises.

## Tests

| Fichier | Contenu |
|---|---|
| `backend/lib/studentCardHolder.test.js` | Matrice, normalisation, priorités, établissements mixtes (fail-closed : niveau absent, désactivé, illisible, surcharge d'un autre niveau, conflit global / niveau), lecture fail-closed, validation des paramètres |
| `backend/lib/studentCardHolder.http.pg.test.js` | Routes HTTP de production et PostgreSQL : garde d'émission et de remplacement avant jeton, trois sources, établissement mixte (inscription absente ou non courante, classe sans niveau, niveau archivé ou retiré, réactivation, niveau étranger, conflit global / niveau), cohérence transactionnelle avec désactivation concurrente (validée ou annulée), isolation, RBAC, cartes existantes intactes |
| `web/src/components/students/StudentCardTab.test.tsx` | Émission et remplacement désactivés, refus serveur |
| `web/src/components/students/StudentCardSettingsSection.test.tsx` | Réglage global, surcharges par niveau, droits |
| `web/src/lib/studentCardPolicy.test.ts` | Règle d'affichage, message |
