# Cause racine — synchronisation du tableau de bord (P1)

**Statut :** correction sur `develop` uniquement. `main` et la production ne sont pas touchées.  
**Base :** `origin/develop` @ `29714cba` (PR #818).  
**Préproduction :** les 8 cases de recette restent à valider sur Render après déploiement de cette branche. Ce dépôt ne joint pas l’environnement Render.

## Pourquoi #817 et #818 n’ont pas suffi

#817 a rétabli le périmètre Admin School quand le header d’école est absent. #818 a ajouté `upsert_attendance` et les actions de planning à l’allowlist, et un poll de 10 s du fil. Les deux laissent deux trous.

### 1. L’événement PostgreSQL n’est pas celui que le fil demande

| Action | Écriture réelle | Avant ce correctif |
| --- | --- | --- |
| Appel | `upsert_attendance_batch`, dans la transaction `upsertAttendanceBatch`, avec `presenceSchoolId` | L’allowlist ne contenait que `upsert_attendance`, écrit seulement par le moteur mémoire. En PostgreSQL la ligne existait et le fil l’ignorait. |
| Planning déplacé | `update_course_schedule`, dans la même transaction que le créneau | L’audit recevait `schoolCode` = `login_code` (CD-IN-26-001). `pedagogyPgStore.getSchoolByCode` ne cherchait que `schools.school_code`. `school_id` restait NULL. Le fil filtre `school_id = $1` : la ligne était invisible. Le libellé « Planning modifié » ne portait ni jour ni heure. |
| Paiement | `create_payment`, dans la transaction finance | Action absente de l’allowlist. Les recettes, lues dans le cache Web, ne bougeaient pas. |
| Élève | `enroll_student` après l’insert, `school_id` résolu par `login_code` **ou** `school_code` | L’événement peut exister. Le KPI Élèves restait l’ancien snapshot. |
| Classe | `create_class` dans la transaction, `school_code` canonique | Même constat : l’événement peut exister, le KPI Classes non. |

Ajouter un nom à l’allowlist ne crée pas la ligne, et une ligne sans `school_id` n’est pas une activité d’établissement.

### 2. Les KPI ne sont pas invalidés

`OverviewPage` calcule élèves, classes, présence du jour, recettes et graphiques depuis `DataContext`. Une écriture réussie ne rappelait pas ces domaines. Le fil, lui, ne se rafraîchissait que pour `/presences` et `/course-schedules`, pas pour `/classes` ni `/payments`. Une autre session n’avait aucun signal : le poll de 10 s ne concernait que le fil.

## Correctif

- Allowlist alignée sur les actions réellement journalisées, y compris `upsert_attendance_batch` et `create_payment`.
- Résolution d’école de l’audit pédagogie : `school_code` ou `login_code`, et `schoolId` du créneau passé explicitement.
- Paiement : `school.id` de la transaction écrit dans `audit_logs.school_id`.
- Détail public du planning : jour, heure, classe, matière. Montant et devise pour un paiement. Nombre de présences pour un appel. Jamais le JSON d’audit, jamais le nom porté par le paiement.
- Après une écriture élève, classe, présence, planning ou paiement : événement local immédiat. Le tableau de bord relit les domaines KPI et le fil. Les autres sessions sont reprises par le poll de 10 s déjà convenu, étendu aux indicateurs. Une erreur réseau s’affiche et la tentative suivante reprend.

## Échec CI Communications C4 (run 36275098043)

Le job `communications-c4` a échoué sur `RED-N4-TR-01` avec `terminating connection due to administrator command`. Ce n’est pas une assertion du tableau de bord : le fichier `communicationsPlanningNavigation.red.test.js` n’est pas modifié par le correctif métier, et les tests suivants du même job (`RED-N4-TR-02`, `RED-N4-TR-03`, `RED-N4-SEPARATION`) sont passés.

Le journal PostgreSQL du service, horodaté à la même seconde que l’échec (`22:09:06.980` et `22:09:06.982`, PID 1352 et 1355), porte exactement `FATAL: terminating connection due to administrator command`, puis un checkpoint forcé. C’est la signature de `pg_terminate_backend`, appelé dans le `finally` de `withIsolatedPg` avant `DROP DATABASE`. Le même message a déjà fait échouer `RED-N5-02` sur le run 36261274250, puis le run suivant de cette PR était vert. Le serveur est resté disponible.

`guardPgPool` absorbe cette coupure de nettoyage sur les pools du pas « Notifications navigation C0 à C3 ». Une autre erreur de connexion continue de remonter. La CI de ce commit doit repasser entièrement verte avant Ready.

## Dette technique distincte — `enroll_student`

Hors de ce correctif. `POST /api/classes/:classCode/students` valide l’inscription, puis appelle `auditService.record(..., "enroll_student", ...)` après le commit (`backend/server.js`). Si cet audit échoue, l’élève existe sans activité. L’inscription et l’événement doivent être écrits dans la même transaction. Ce chantier ne bloque pas l’explication de C4 et ne change pas la production.

## Recette préproduction (0/8 tant que Render n’a pas cette branche)

- [ ] Un appel enregistré apparaît sans recharger la page.
- [ ] Un planning déplacé apparaît avec le jour et l’heure.
- [ ] Les KPI et graphiques reflètent élèves, classes, présences et recettes.
- [ ] Une autre session voit le changement en au plus 10 s.
- [ ] Aucune activité d’un autre établissement.
- [ ] Erreur réseau explicite, puis reprise au poll suivant.
- [ ] Disposition compacte inchangée.
- [ ] Tests et CI verts.
