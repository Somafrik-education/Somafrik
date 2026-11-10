# BULLETIN-UI-01 — interface de gestion des bulletins (Web, Mobile, PDF)

Statut : **PR Draft, HOLD** (NO READY / NO MERGE / NO DEPLOY). Base : `develop@a3eef9cb`.

## 1. Audit (existant réutilisé)

| Élément | Existant | Utilisation dans ce lot |
|---|---|---|
| Moteur | `reportCardEngine.js` + `reportCardSubjectTotals.js` (MODEL-01) : `subject_totals` (matières simples / composées, TJ/EX, maxima, totaux, %, rang) | **inchangé** ; seule source des valeurs affichées |
| Aperçu / publication | `POST /api/report-card/publications/preview` (`REPORT_CARD_GENERATE`), `POST /api/report-card/publications` (`REPORT_CARD_PUBLISH` + `expectedDraftSha256`) — PUBLISH-01 | **inchangés** ; l'aperçu reçoit en plus une présentation non officielle |
| Lecture publiée | `GET …/publications`, `…/:id/snapshot`, `…/:id/history`, `…/:id/versions/:v`, `…/:id/pdf` ; parents bornés par `studentIds` | **inchangés** |
| RBAC | `reportCardHttpActor.js` (Bulletins:READ/UPDATE, « Valider bulletins », parent/élève jamais GENERATE/PUBLISH) | **inchangé** |
| PDF | `reportCardPdf.js` + `templates/reportCard/canonical.{html,css}`, Chromium sans ressource externe (interception), QR stratégie A | étendu : mise en page par matières |
| Gabarits | `renderingTemplate.js` (spec normalisée + SHA-256), workflow LOT 6/7 (page Superadmin) | bloc optionnel `presentation` ; sélecteur de style dans la page existante |
| Web | `ParentReportCardsPage`, `ReportCardHistoryPage`, workflow LOT 7, GrapesJS (`/parametres/documents`, conception visuelle de l'ancien circuit) | nouvelle page `/bulletins/gestion` ; résultats ajoutés à la page parent ; GrapesJS non dupliqué, non modifié |
| Mobile | `ReportCardsScreen` natif (liste, enfant, PDF, versions) — LOT 8 | résultats natifs par matière + filtres période / classe |

## 2. Ce qui est ajouté

### Backend (présentation seulement — aucun calcul)

* `backend/lib/reportCard/reportCardPresentation.js` : adaptateur pur `subject_totals` → présentation. Lit les valeurs `exposed` du moteur ; le sous-total d'une matière composée est celui du moteur, le total général aussi (lignes de premier niveau) : **aucune double comptabilisation possible**. Intitulés : profil, sinon catalogue de l'établissement, sinon identifiant (rien de codé en dur).
* Styles : `simple` (modèle A, La Colombière) / `hierarchical` (modèle B, Le Berceau de la Sagesse) / `auto` (hiérarchique si le profil a une matière composée).
* `renderingTemplate.js` : bloc **optionnel** `presentation: { style, signatures[≤4] }`. Absent ⇒ spec normalisée et empreinte **identiques** à avant (gabarits existants et bulletins publiés inchangés).
* `backend/db/reportCardPresentationLabelsStore.js` : libellés (établissement, classe, année, matières, nom des élèves), chaque requête bornée à `school_id` du bulletin.
* HTTP : `GET /api/report-card/publications/:id/presentation?version=` (`REPORT_CARD_READ`, même consultation et même borne parent que `/snapshot`) ; l'aperçu renvoie `students[].presentation` avec `official: false` ; le PDF publié utilise la présentation quand le snapshot a des totaux par matière.
* PDF : tableau Maxima / Obtenu par période (TJ, EX, Total), total annuel, Total / Pourcentage / Rang, appréciations, signatures configurées, référence + QR de vérification existants. Bulletins historiques (sans `subject_totals`) : rendu générique d'origine.

### Web

* `/bulletins/gestion` (bouton « Gérer les bulletins » sur Bulletins) : filtres année, classe, modèle actif, période, élève, statut ; « Prévisualiser » (aucune action à l'ouverture) ; liste (nom, matricule, classe, état des notes, statut, pourcentage, rang, actions) ; anomalies ; aperçu marqué **BROUILLON** ; publication de la classe après **confirmation** (classe, période, nombre de bulletins) avec l'empreinte de l'aperçu ; bulletin publié : consultation, PDF, impression, versions.
* Périodes proposées : celles du modèle, renvoyées par l'aperçu (jamais une liste codée en dur).
* Enseignant sans droit : ni aperçu ni publication affichés ; un 403 serveur est traduit, jamais contourné.
* Parent : « Afficher les résultats » sur chaque bulletin officiel publié (établissement, classe, année, période, résultats) + PDF existant.
* Superadmin : sélecteur « Présentation du bulletin » qui écrit `presentation.style` dans le gabarit JSON existant.

### Mobile (natif Expo, sans WebView)

* `ReportCardsScreen` : filtres Période et Classe (personnel), « Voir les résultats par matière » ; états chargement / droits insuffisants / erreur / bulletin historique.
* `ReportCardPresentationView` : une période à la fois (Trimestres, Bilan annuel), chaque matière et sous-matière avec « TJ note / max », « EX note / max », total : aucune matière ni maximum supprimés sur téléphone.
* PDF officiel : téléchargement existant puis ouverture par le lecteur du système (partage / impression selon l'appareil).

## 3. Sécurité et qualité (preuves : `reportCardUi01.http.pg.test.js`, `reportCardPresentation.test.js`)

| Exigence | Vérification |
|---|---|
| Isolation établissement | B ne lit pas un bulletin de A (403/404, aucun nom dans l'erreur) ; libellés bornés à `school_id` |
| Publication | uniquement `REPORT_CARD_PUBLISH`, après confirmation de l'empreinte ; enseignant et plateforme refusés |
| Parents | enfant lié seulement ; autre enfant / parent non lié refusés ; aperçu non publié refusé (403) |
| Fidélité au snapshot | totaux T1–T3 et annuel de la présentation = `subject_totals` scellés ; texte du PDF contrôlé (pdftotext) |
| Immuabilité | snapshot et lignes `report_card_published_snapshots` identiques avant / après présentation et PDF |
| Double comptage | total général = lignes de premier niveau ; test explicite qu'additionner sous-matières et matières différerait |
| Notes manquantes | « Manquante » (jamais 0), élève incomplet, non classé |
| Fuite d'erreur | codes métier traduits ; message technique jamais affiché |
| HTML / PDF | toutes les valeurs échappées ; seules des ressources `data:` ; interception Chromium inchangée |
| Compatibilité | bulletin historique : présentation nulle, PDF générique d'origine ; gabarits sans `presentation` : empreinte inchangée |

## 4. Limitations résiduelles

1. **Identité figée** : le snapshot scellé ne contient que le matricule et les identifiants (établissement, classe, année). Les noms affichés (élève, établissement, classe, année, matières) sont lus au rendu, bornés à l'établissement. Si un nom change, le PDF d'un bulletin publié affichera le nouveau nom ; les **résultats** restent ceux du snapshot. Figer les libellés impose de modifier le contrat de publication (hors périmètre) : décision CTO.
2. **Appréciations** : le modèle canonique n'a pas de texte d'appréciation saisi ; le PDF affiche la décision si le profil en calcule une, puis une zone manuscrite.
3. **Signatures** : intitulés configurables dans le gabarit (`presentation.signatures`) ; pas d'image de signature.
4. **Aperçu PDF** : l'aperçu est un écran marqué BROUILLON ; aucun PDF de brouillon n'est produit (aucun document non officiel imprimable).
5. **Mobile** : pas de publication (Web uniquement, comme avant) ; captures d'écran Mobile non produites (pas d'émulateur Expo dans l'environnement) ; logique de lecture téléphone testée (`reportCardPresentationMobile.test.ts`).
6. **Captures Web** : produites avec l'application réelle (composants et styles) et des réponses API simulées issues du moteur réel (`docs/project/bulletin-ui-01/`).

## 5. Exemples

`docs/project/bulletin-ui-01/` : PDF officiels réels (modèle A et B, rendu Chromium du test PostgreSQL), aperçus PNG, captures Web (aperçu de classe, aperçu BROUILLON, confirmation, anomalies, bulletin publié modèle B, enseignant, parent).
