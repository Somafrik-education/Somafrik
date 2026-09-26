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

## Recette préproduction (0/8 tant que Render n’a pas cette branche)

- [ ] Un appel enregistré apparaît sans recharger la page.
- [ ] Un planning déplacé apparaît avec le jour et l’heure.
- [ ] Les KPI et graphiques reflètent élèves, classes, présences et recettes.
- [ ] Une autre session voit le changement en au plus 10 s.
- [ ] Aucune activité d’un autre établissement.
- [ ] Erreur réseau explicite, puis reprise au poll suivant.
- [ ] Disposition compacte inchangée.
- [ ] Tests et CI verts.
