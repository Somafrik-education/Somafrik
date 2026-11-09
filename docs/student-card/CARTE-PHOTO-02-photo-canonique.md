# CARTE-PHOTO-02 — photo d’identité canonique sur toutes les cartes

Statut : **DRAFT / HOLD**. Aucune fusion, aucun déploiement sans autorisation CTO.

## Cause racine

La photo d’un élève est déposée dans ses **pièces administratives** (FICHE-DOC-01) :
`POST /api/students/:id/documents` avec le type `PHOTO`. Cette route crée une ligne
`student_documents` (type `PHOTO`, `metadata.source = administrative_upload`) et écrit le fichier
dans le stockage privé (`SOMAFRIK_COMMUNICATION_STORAGE`).

Elle **ne renseigne jamais** `students.photo_url`. Aucun chemin du produit n’écrit ce champ : toutes
les insertions d’élève le posent à `''` (`classStudentsRepository.insertStudentWithEnrollment`,
`postgresRepository`), et aucune mise à jour ne le modifie.

Or la carte lisait uniquement ce champ :

`students.photo_url ('')` → `GET /api/students/:id` → `photoUrl: ""` → `StudentCardTab` → `StudentCardPrintView` → initiales.

CARTE-PHOTO-01 (#990) a amélioré le **chargement** d’une URL de photo (URL relative, lecture JWT),
mais l’URL n’existait pas : la valeur était perdue dès PostgreSQL. La carte affichait donc
« KO » même avec une photo présente dans le dossier.

Le lot par classe avait la même cause (photo lue dans le `photoUrl` vide de la liste de classe).

## Correctif

Une seule source : la pièce `PHOTO` déjà stockée. Aucun nouveau stockage, aucune copie.

- `GET /api/students/:studentId/photo` (lecture seule) : la pièce `PHOTO` la plus récente,
  déposée ou vérifiée, non archivée. Mêmes contrôles que le téléchargement d’une pièce :
  élève du tenant (`authorizeEnrollmentStudentOr404`), droit `Documents:READ`, requête scellée
  `school_id + student_id`. Réponse `private, no-store`, `nosniff`, aucun chemin de stockage exposé.
- Codes d’erreur non sensibles : `STUDENT_PHOTO_ABSENT`, `STUDENT_PHOTO_FILE_MISSING`
  (ligne présente, fichier disparu du stockage), `STUDENT_PHOTO_INVALID`.
- Web : `useStudentCardPhoto` lit cette route avec le client JWT (jamais de jeton dans une URL),
  crée une URL locale `blob:` et la révoque à chaque changement d’élève, d’établissement ou à la
  fermeture. L’ancien `photo_url` n’est utilisé que si le dossier n’a aucune pièce `PHOTO`.
- Lot par classe : même lecture, image recadrée et intégrée au document v2 (CARTE-BATCH-DESIGN-01).
  Le PDF A4 relit uniquement le document : aucune requête réseau, aucune émission.

| Situation | Carte |
| --- | --- |
| Photo existante et accessible | vraie photo |
| Aucune photo | initiales |
| Photo inaccessible (fichier disparu, contenu illisible, serveur indisponible) | initiales + diagnostic non sensible |
| Photo remplacée | la plus récente |
| Changement d’élève ou d’établissement | photo effacée immédiatement, URL locale révoquée |
| Droits insuffisants (`Documents:READ` absent) | aucune image, initiales + diagnostic |
| Impression CR80, HTML CR80 par classe, PDF A4 | même photo |

La maquette P1 n’est pas modifiée.

## Diagnostic préproduction (lecture seule)

Requête à exécuter par une personne autorisée sur la base de préproduction. Elle ne renvoie que des
compteurs et des booléens : ni URL, ni chemin, ni image.

```sql
SELECT
  (st.photo_url IS NOT NULL AND btrim(st.photo_url) <> '')                AS photo_url_renseigne,
  count(d.id) FILTER (WHERE d.status IN ('submitted','verified'))         AS pieces_photo_actives,
  count(d.id) FILTER (WHERE d.status = 'archived')                        AS pieces_photo_archivees,
  bool_or(d.storage_key IS NOT NULL AND d.storage_key <> '')              AS cle_stockage_presente
FROM students st
JOIN schools sc ON sc.id = st.school_id
LEFT JOIN student_documents d
  ON d.student_id = st.id AND d.school_id = st.school_id
 AND d.document_type = 'PHOTO' AND d.metadata->>'source' = 'administrative_upload'
WHERE st.student_code = 'CD-IN-KO-26-00009'
GROUP BY st.photo_url;
```

Lecture :
- `pieces_photo_actives = 0` et `photo_url_renseigne = false` → **donnée absente** (aucune photo déposée).
- `pieces_photo_actives ≥ 1` → cause racine confirmée ; après déploiement, la carte doit afficher la photo.
- Si la carte affiche alors « fichier introuvable sur le serveur » : la ligne existe mais le fichier
  a disparu du stockage. Vérifier que `SOMAFRIK_COMMUNICATION_STORAGE` pointe vers un disque
  persistant du service Render (un disque éphémère est vidé à chaque déploiement).

## Smoke

Le smoke navigateur exécuté dans un environnement isolé (PostgreSQL local, API et Web locaux,
données de démonstration) est décrit dans la PR. Le smoke sur la préproduction Render
(SMOKE-PHOTO-01 sur `CD-IN-KO-26-00009`) reste à exécuter par une personne ayant accès à
l’environnement ; il n’émet, ne remplace ni ne révoque aucune carte.

## Tests

- `backend/lib/studentCardPhoto.http.pg.test.js` (HTTP + PostgreSQL) : reproduction de la cause
  racine, photo réelle, remplacement, archivage, absence, fichier disparu, isolation
  inter-établissements, 403 sans `Documents:READ`, 401 sans jeton, cartes inchangées.
- `backend/lib/studentAdministrativeDocuments.test.js` : requête scellée, droits, codes d’erreur.
- `web/src/lib/studentCardPhoto.test.ts` : états, chemin sûr, repli `photo_url`, changement
  d’élève et d’établissement, révocation des URL locales.
- `web/src/components/students/StudentCardPrintView.photo.test.tsx` : carte individuelle.
- `web/src/lib/studentCardBatchPrintable.test.ts` : lot par classe, HTML CR80, PDF A4 hors connexion.
