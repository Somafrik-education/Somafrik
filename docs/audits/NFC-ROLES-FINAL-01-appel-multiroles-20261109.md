# NFC-ROLES-FINAL-01 — Appel NFC/QR local-first multirôle

**Statut : DRAFT / HOLD — NO READY — NO MERGE — NO DEPLOY.** Base : `develop@624261be` (#1133 fusionnée).

## 1. Règle appliquée
- Les **permissions** déterminent les actions possibles ; le **rôle** (clé canonique relue en PostgreSQL) détermine le périmètre.
- Le serveur décide seul, à chaque génération de pack et à chaque synchronisation.
- Aucun rôle `TEACHER` fictif, aucune affectation artificielle, aucun `teacherId` falsifié, aucune permission ajoutée.

## 2. Audit de l'existant (`develop@624261be`)

| Élément | Avant |
|---|---|
| `GET …/offline/v1/pack` | `authorizeRollCallActor(actor, "teacher")` : clé `TEACHER` exigée ; `assertRollCallClass(…, "teacher")` : affectation exigée |
| `POST …/offline/v1/sync`, garde R (relire son ACK) | clé `TEACHER` exigée |
| `POST …/offline/v1/sync`, garde W (écrire) | `TEACHER` + affectation ; écriture via `upsertSchoolAttendanceBatch`, qui exige un enseignant explicite pour un non-enseignant (`ATTENDANCE_TEACHER_UNRESOLVED`) |
| Journal `attendance_roll_calls` | `mode` ∈ {teacher, direction} ; `teacher` ⇒ `teacher_id` non nul ; une ligne hors ligne ⇒ `mode = 'teacher'` |
| Appel de direction (en ligne, `/validate` `mode: direction`) | `DIRECTION_ROLE_KEYS` + `Présences:UPDATE`, justification obligatoire, `teacher_id` NULL |
| Permissions de route | `Présences:CREATE` ou `Présences:UPDATE`, relues en direct (`resolveEffectivePermissions`) |
| Mobile | `canOpenOfflineRollCall` et `canOpenOfflineSyncList` réservés à `actor.teacher` ; boutons « Carte NFC », « Scanner QR », appel collectif en ligne, appel exceptionnel NFC/QR |

## 3. Contrat d'autorisation unifié (pack = synchronisation)

`resolveClassRollCallAuthority` (`backend/lib/studentCardRollCall.js`), appelée par le pack et par la garde W :

1. Rôles actifs relus en base (`liveRollCallActor`) : clés connues uniquement, aucun rôle plateforme.
2. Permission effective live `Présences:CREATE` ou `Présences:UPDATE`.
3. Classe **active de l'établissement du compte**.
4. **Cas A — enseignant** : clé `TEACHER`, rôle `TEACHER` accordant lui-même l'écriture, affectation active à la classe.
   - Autorité `teacher`, présences attribuées à l'enseignant affecté : comportement historique inchangé.
5. **Cas B — responsable scolaire** : `SCHOOL_ADMIN`, `PROVISEUR`, `PRINCIPAL`, `PREFET_ETUDES` ou `SECRETARY`, dont le rôle **pris isolément** accorde l'écriture des présences.
   - Le pipeline est celui des permissions effectives, en évaluation « sans sujet » d'un jeu de rôles explicite.
   - Autorité `staff`, sur toutes les classes actives de son établissement, `teacher_id` NULL.
6. Sinon : `ROLL_CALL_CLASS_FORBIDDEN` (rôle capable, classe hors périmètre) ou `ROLL_CALL_ROLE_FORBIDDEN` (autre rôle).

**Pourquoi le rôle « pris isolément »** : les permissions effectives sont l'union de tous les rôles. Sans cette règle, un Enseignant + Secrétaire dont seul le rôle Enseignant a le droit de présence obtiendrait le périmètre de tout l'établissement. C'est un élargissement implicite, désormais refusé (testé).

**Garde R** : clé `TEACHER` **ou** de responsable scolaire, relue en base ; jamais un rôle plateforme. Elle est toujours indépendante de la session et de l'affectation.

**Périmètre Préfet / Proviseur / Principal** : celui de l'établissement, identique à l'appel de direction existant. Aucune restriction de classe par rôle n'existe dans le système ; aucune n'a été inventée.

**Autres rôles** (Surveillant, Comptable, rôles personnalisés) : refusés, même avec le droit de présence. Aucun périmètre de classe n'est défini pour eux (fail-closed).

### Matrice RBAC après

| Profil (clé canonique) | Pack | Synchronisation | Périmètre | Journal |
|---|---|---|---|---|
| Enseignant (`TEACHER`) affecté | ✅ | ✅ | classes affectées | `teacher`, `teacher_id` = enseignant |
| Enseignant non affecté | ❌ `CLASS_FORBIDDEN` | ❌ `CLASS_FORBIDDEN` + `not_recorded` | — | — |
| Directeur / Admin School (`SCHOOL_ADMIN`) autorisé | ✅ | ✅ | classes actives de l'établissement | `staff`, `teacher_id` NULL |
| Secrétaire (`SECRETARY`) autorisé | ✅ | ✅ | idem | `staff` |
| Préfet / Proviseur / Principal autorisés | ✅ | ✅ | idem | `staff` |
| Responsable sans droit de présence | ❌ 403 | ❌ 403 | — | — |
| Enseignant + Directeur | ✅ | ✅ | sa classe → `teacher` ; autres classes → `staff` | selon la classe |
| Enseignant + Secrétaire **sans** droit secrétaire | sa classe ✅, autres ❌ | idem | pas d'élargissement | `teacher` |
| Surveillant, Comptable, rôle personnalisé | ❌ `ROLE_FORBIDDEN` | ❌ | — | — |
| Parent, Élève | ❌ 403 | ❌ 403 | — | — |
| Superadmin, Admin pays | ❌ 403 | ❌ 403 | — | — |
| Compte désactivé, rôle révoqué, droit retiré | ❌ 401/403 | ❌ 401/403 | — | — |
| Classe d'un autre établissement | ❌ `CLASS_FORBIDDEN` ; lot de A envoyé par B → `REPLAY_FORBIDDEN` | | | |

## 4. Écriture et traçabilité
- **Écriture `staff`** (`writeStaffAttendance`) : mêmes gardes conditionnelles que `upsertSchoolAttendanceBatch`.
  - Création seulement si aucune ligne n'existe ; correction seulement d'une absence.
  - Statuts protégés intacts.
  - `teacher_id` NULL, comme l'appel de direction.
  - L'inscription des élèves est vérifiée sous `lockEnrolledRoster FOR SHARE` (appel partiel).
- **Journal** : nouveau `mode = 'staff'` : `teacher_id` NULL, sans justification, auteur réel (`author_user_id`, `author_role_keys`).
- **Audit** (`student_card_roll_call_offline_sync`) : `authority: teacher | staff`, `coverage`, auteur, rôles et classe.
- **Migration** `20261110_attendance_roll_calls_staff_mode.sql`, additive et idempotente :
  - `mode_check` et `mode_shape_check` sont élargies à `staff` ;
  - `offline_shape_check` accepte `staff` pour les lignes hors ligne et borne explicitement les lignes en ligne à `teacher` et `direction` (toutes les lignes existantes) ;
  - aucune donnée n'est modifiée ; une réapplication ne change rien (testé).

## 5. Compatibilité des anciens appels
- **Contrat `rc-offline-1`** : inchangé (champs, preuves, digest). La valeur `mode: "teacher"` du lot reste la valeur unique du contrat (« appel de classe ») ; l'autorité réelle est décidée par le serveur.
- **Corps figés existants des enseignants** : traités exactement comme avant (autorité `teacher`).
- **Routes en ligne** (`/scan`, `/roster`, `/validate`, appel de direction) : inchangées côté serveur. Elles ne sont simplement plus proposées par l'écran Présences du Mobile.
- **Lignes `attendance_roll_calls` existantes** : intactes.

## 6. Mobile
- `rollCallActor().rollCall` : `TEACHER` ou responsable scolaire (même liste que le serveur) **et** `Présences:CREATE` ou `UPDATE`. Clés canoniques uniquement : un libellé personnalisé (« Directeur », « Professeur ») ne change rien.
- **Écran Présences : trois actions de carte.**
  1. « Vérifier une carte » : inchangé, sans écriture.
  2. « Démarrer l'appel NFC/QR » : moteur local-first, pour tout rôle autorisé. La fenêtre s'intitule désormais « Appel NFC/QR ».
  3. « Vérifier les appels (Appels hors connexion) » : appels de la base SQLCipher du **compte connecté uniquement**, avec un texte qui le précise. L'aperçu de supervision serveur existant (`StudentCardRollCallOverview`) reste « les appels de l'établissement » ; aucun second stockage.
- **Boutons retirés** :
  - « Carte NFC » et « Scanner QR » (ancien pointage de présence) ;
  - « Faire l'appel de la classe » (appel collectif en ligne) ;
  - « Appel exceptionnel NFC », « Appel exceptionnel QR » et leur reprise.
  - Les services, les API et les fenêtres correspondantes ne sont **pas** supprimés : ces fenêtres sont devenues inatteignables depuis cet écran, et leur nettoyage relève d'un chantier séparé.
- **Moteur rapide** inchangé : aucune requête HTTP par carte, COMMIT SQLCipher puis affichage, notification non bloquante, isolation par compte (NFC-STATUT-PRESENCE-01).

## 7. Tests

| Test | Résultat local |
|---|---|
| **Nouveau** `backend/lib/rollCallRoles.http.pg.test.js` (PostgreSQL 16 réel, serveur réel, 35 élèves) | **vert** ; **rouge** sur `develop` |
| `rollCallOfflinePack.http.pg.test.js` | vert ; l'assertion « direction : pas de pack enseignant » est remplacée par « responsable autorisé : pack lié à lui-même » |
| `rollCallOfflineSync`, `rollCallOfflinePartial`, `studentCardRollCall` (`/validate`) PG | verts, inchangés |
| Base unitaire backend | 2 934 réussis, 0 échec, 3 ignorés ; la garde R accepte désormais les responsables (test mis à jour) |
| **Nouveau** `Mobile/src/lib/nfcRolesFinal.test.ts` | 3/3 : matrice de 17 profils, trois boutons, aucun ancien bouton, libellés |
| Tests Mobile des cartes (`studentCardRollCallRoles`, `ClassRollCall`, `EntryControl`, `Scan`, `Nfc`, `verify-student-card-qr`) | verts ; leurs assertions sur les anciens boutons vérifient désormais leur **absence** |
| `test:rollcall-offline` (SQLCipher) | 153/153 |
| `test:lot0-parity`, `test:lot1-parity`, `verify:mobile-attendance-hydration`, `verify:mobile-home-data-truth`, `verify:canonical-state-convergence`, `verify:sync-end-to-end`, TypeScript | verts |
| `Mobile/scripts/verify-mobile-usability.js` | **rouge, déjà rouge sur `develop`** (écran Annonces, sans lien) |

Le nouveau test PostgreSQL couvre :
- **Directeur, puis Secrétaire, sans affectation** : pack de 35 élèves ; 22 scans donnent 22 présences avec `teacher_id` NULL et aucune ligne pour les 13 autres ; ACK conforme ; journal `staff` avec l'auteur réel et sans `TEACHER` ; audit `authority: staff` ; rejeu idempotent ; aucun doublon.
- **Enseignant affecté** : journal `teacher`, présences attribuées à l'enseignant.
- **Refus, au pack et à la synchronisation** : enseignant non affecté, surveillant (même avec le droit), parent, superadmin, classe d'un autre établissement, lot de l'établissement A envoyé par B, compte désactivé.
- **Enseignant + Proviseur** : sa classe en autorité `teacher`, une autre classe en `staff`.
- **Révocations** :
  - droit secrétaire retiré entre le pack et la synchronisation : refus ;
  - Enseignant + Secrétaire sans droit secrétaire : aucun élargissement ;
  - rôle révoqué en base : refus ;
  - Directeur sans droit : refus ;
  - aucune présence n'est écrite par un refus.
- **Migration** : contraintes élargies, réapplication idempotente.

**Non exécutés :**
- preuve native **Hermes / SQLCipher Android** : pas d'appareil dans la session, à fournir par le workflow CI dédié ;
- **smoke physique** avec l'APK Preview ;
- suites PostgreSQL complètes (3 lots), laissées à la CI.

## 8. Performance
- Le chemin de lecture des cartes n'est pas modifié : aucune requête HTTP par carte, COMMIT local, notification d'écran différée.
- Seuls le pack et la synchronisation font des lectures supplémentaires, une fois par appel et non par carte : permissions du rôle et affectation.
- Les mesures de NFC-STATUT-PRESENCE-01 restent valables (relecture locale p95 0,47 ms en Node, pas sur appareil).

## 9. Risques résiduels
- **Préfet, Proviseur, Principal** ont le périmètre de tout l'établissement, comme l'appel de direction existant. Une restriction par classe exigerait un modèle de périmètre qui n'existe pas aujourd'hui.
- **Droit retiré entre le pack et la synchronisation** : la synchronisation est refusée (403). Le refus intervient avant la garde d'écriture, donc probablement sans `sessionState: not_recorded` (code exact non vérifié dans le test). Le Mobile garde alors l'appel en échec, sans révision automatique : c'est conforme au « fail-closed », mais il faut l'intervention de la direction.
- **Anciennes fenêtres** (pointage individuel, appel collectif en ligne, appel exceptionnel) : encore montées dans l'écran mais inatteignables. Suppression à planifier.
- **Supervision** : l'aperçu serveur reste masqué pour `SCHOOL_ADMIN` (règle existante de CARTE-UX-ROLE-01), non modifiée ici.

## 10. Smoke physique (APK Preview préproduction)
1. Enseignant : appel NFC rapide de sa classe ; changement immédiat d'« Absent » provisoire à « Présent ».
2. Directeur autorisé : choisir une classe **sans affectation personnelle**, scanner 10 cartes, vérifier « Présent » immédiat.
3. Clôturer et synchroniser. En PostgreSQL : 10 présences, `teacher_id` NULL, `attendance_roll_calls.mode = 'staff'`, `author_user_id` = Directeur ; audit `authority = staff`.
4. Recommencer avec la Secrétaire autorisée.
5. Retirer le droit de présence de la Secrétaire, puis faire un nouvel appel : refus au pack ou à la synchronisation, aucune présence écrite.
6. Sur chaque compte : seuls les trois boutons s'affichent selon les droits ; la liste « Vérifier les appels » ne montre que les appels du compte connecté ; aucune donnée d'un autre compte.
7. Appel partiel et absences provisoires : non scannés « Absent (provisoire) », jamais écrits sans confirmation.
8. Enchaîner les cartes : aucune attente perceptible ; mode avion pendant le scan.
