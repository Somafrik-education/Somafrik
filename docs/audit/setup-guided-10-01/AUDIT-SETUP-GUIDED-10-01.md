# AUDIT-SETUP-GUIDED-10-01 — Configuration guidée en 10 étapes (Web + Mobile)

| Champ | Valeur |
|---|---|
| Base auditée | `develop@4560495b457980b438f50b2be5674bda7826a1e1` |
| Correctif | branche `audit/setup-guided-10-01`, commit `6f6fef9a255df541d9ce0213d266a76bb0297b94` |
| Données de production | **Non lues, non modifiées** (aucune autorisation spécifique) |
| Statut | **DRAFT / HOLD — pas de merge, pas de déploiement** |

## 1. Synthèse

L'assistant applique bien ses règles. Leur expression et leur lecture des données présentent toutefois cinq défauts. Deux autres défauts concernent la parité Mobile.

1. Le message de l'étape 1 cite toujours les 5 champs exigés, même quand un seul manque.
2. Le formulaire Profil laisse l'adresse facultative et n'affiche pas la devise, alors que l'étape 1 exige les deux.
3. L'étape 1 lit la devise, l'adresse et le téléphone autrement que l'API Profil, ce qui peut produire un faux échec.
4. Cinq étapes comptaient des données archivées ou retirées, ce qui produisait un **faux succès** après invalidation.
5. Le lien de correction de l'étape 8 menait, sur le Web comme sur le Mobile, à un écran où l'on ne peut pas créer de type d'évaluation.
6. **Ouvert :** le Mobile n'a aucun écran pour enregistrer les règles de notification (étape 9).
7. **Ouvert :** le Mobile masque une erreur de chargement de l'assistant.

Les défauts 1 à 5 sont corrigés dans la PR Draft, avec des tests RED puis GREEN. Les défauts 6 et 7 sont documentés et feront l'objet de PR séparées.

## 2. Anomalie initiale de production (`SCH-861371F01E094E9E8970`)

**Champ bloquant le plus probable : l'adresse.** C'est une déduction à partir de la capture et du code. Elle n'a pas été vérifiée en base, puisque la lecture des données de production n'est pas autorisée.

| Champ | Source lue par l'étape 1 | Observation (capture) | Verdict |
|---|---|---|---|
| Nom | `schools.name` | Présent | OK |
| Pays | `schools.country_id` (NOT NULL à l'écriture : pays résolu obligatoirement) | BURUNDI | OK |
| Adresse | `schools.address` | **Vide** | **Bloquant** |
| Téléphone | `schools.phone` | Présent | OK |
| Devise | `profile_payload.currency`, sinon `countries.currency` (NOT NULL, BIF pour le Burundi) | Non affichée par le Profil | OK, sauf si `profile_payload.currency = ""` (défaut A2) |

**Pourquoi l'utilisateur ne pouvait pas comprendre l'erreur :**
- le Profil n'indique pas l'adresse comme obligatoire (`FormField` sans `required`, aucun contrôle dans `validateSchoolForm`) ;
- la devise n'est affichée nulle part ;
- le message cite les 5 champs sans dire lequel manque.

**Requête de confirmation**, en lecture seule, à exécuter uniquement sur GO CTO explicite. Elle ne renvoie que des booléens, aucune donnée personnelle :

```sql
SELECT btrim(COALESCE(s.name, ''))    <> '' AS has_name,
       s.country_id IS NOT NULL               AS has_country,
       btrim(COALESCE(s.address, ''))  <> '' AS has_address_column,
       btrim(COALESCE(s.profile_payload->>'address', '')) <> '' AS has_address_legacy,
       btrim(COALESCE(s.phone, ''))    <> '' AS has_phone,
       btrim(COALESCE(s.profile_payload->>'currency', '')) <> '' AS has_profile_currency,
       btrim(COALESCE(c.currency, '')) <> '' AS has_country_currency
FROM schools s LEFT JOIN countries c ON c.id = s.country_id
WHERE s.school_code = 'SCH-861371F01E094E9E8970' OR s.login_code = 'SCH-861371F01E094E9E8970';
```

**Après le correctif :**
- le formulaire refuse l'enregistrement sans adresse (« L'adresse est obligatoire. ») et affiche la devise ;
- l'assistant répond « Étape « Informations établissement » non satisfaite : champ manquant : adresse. Complétez-le dans Paramètres › Profil établissement. », avec `details.missingFields = [{ key: "address", label: "Adresse" }]` ;
- une fois l'adresse saisie, « Enregistrer et continuer » passe sans reconnexion (test AUDIT10-U-03). La page de l'assistant relit l'état au montage (`SchoolSetupSettingsPage`, `useEffect`) côté Web, et à chaque focus (`useFocusEffect`) côté Mobile.

**Aucune adresse ni devise n'est inventée ou insérée automatiquement.**

## 3. Audit des 10 étapes : conditions réellement appliquées

Source : `backend/lib/schoolSetupGuided.js` (`stepSatisfied` et `loadSchoolSetupGuidedSnapshot`). Toutes les requêtes sont filtrées par `school_id = $1`, et ce `school_id` provient uniquement de `users.school_id` (membership). Aucun `schoolCode` client n'est lu.

| # | Étape | Condition après correctif | Écart constaté avant correctif | Lien Web / Mobile |
|---|---|---|---|---|
| 1 | Informations établissement | Nom, pays, adresse, téléphone et devise non vides, lus comme l'API Profil | Message générique (A1), lecture divergente (A2) | `/parametres/profil` / `EstablishmentProfile` |
| 2 | Année scolaire | Année `is_current` ou `open`, avec `start_date` et `end_date` | Aucun | `/parametres/annee-scolaire` / `SchoolYearSettings` |
| 3 | Structure pédagogique | ≥ 1 niveau actif, ≥ 1 groupe actif, ≥ 1 classe de l'année courante ou ouverte | Aucun | `/parametres/structure` / `SchoolPedagogicalStructure` |
| 4 | Matières | ≥ 1 matière **active** | Archivées comptées (A3) | `/parametres/structure` (`SchoolSubjectsPanel`) / `SchoolPedagogicalStructure` |
| 5 | Enseignants | ≥ 1 enseignant **actif**, et ≥ 1 affectation active (classe et matière) d'un enseignant **actif** | Enseignant archivé compté (A3) | `/etablissement/enseignants` / `Teachers` |
| 6 | Élèves | ≥ 1 inscription `active` ou `enrolled`, dans une classe **du même établissement** | `WITHDRAWN`, `TRANSFERRED` et `CLOSED` comptées (A3) | `/etablissement/classes` / `Classes` |
| 7 | Finance | ≥ 1 grille de frais, ou ≥ 1 mode de paiement actif | Aucun (voir O2) | `/finances/frais` / `FeeGrids` |
| 8 | Paramètres pédagogiques | ≥ 1 type d'évaluation **actif** | Archivés comptés (A3) ; lien vers une page sans création (A4) | **`/parametres/annee-scolaire`** / **`SchoolYearSettings`** (corrigé) |
| 9 | Communication | ≥ 1 règle enregistrée dans `school_notification_settings` | Aucun côté backend (#1171) ; **Mobile sans écran** (A6) | `/parametres/notifications` / `InternalNotifications` (boîte de réception, A6) |
| 10 | Utilisateurs et droits | ≥ 1 compte **actif** rattaché à l'établissement | Archivés comptés (A3) ; voir O1 | `/etablissement/comptes-utilisateurs` / `Users` |

Mécanismes transverses vérifiés (tests existants B1 à B16, puis AUDIT10) :
- la progression se calcule comme le préfixe consécutif des étapes à la fois persistées et satisfaites ;
- une étape persistée redevient non faite si sa donnée disparaît (B4b, puis AUDIT10-PG-04 à 10) ;
- le statut `operational` exige les étapes 1 à 6 (B6, B7). Il est distinct de l'ancien indicateur 3/3 du LOT 0, qui n'a pas été modifié (`schoolSetupStatus.js` intact) ;
- une revalidation est idempotente et ne crée pas de doublon : `ON CONFLICT (school_id) DO UPDATE`, `normalizeCompleted` (B10) ;
- les erreurs ne sont pas masquées : 400 pour une étape inconnue, 403 sans permission ou hors périmètre, 409 pour `STEP_DEPENDENCY`, `STEP_NOT_SATISFIED` et `SETUP_INCOMPLETE`, 503 quand la source est indisponible ;
- la finalisation refuse tant que les étapes 1 à 6 ne sont pas satisfaites et liste celles qui manquent. Une fois enregistrée, elle est conservée (décision antérieure, voir O3).

## 4. Anomalies

| ID | Gravité | Anomalie | Cause racine | Fichiers | Statut |
|---|---|---|---|---|---|
| A1 | **P1** | L'étape 1 cite les 5 champs alors qu'un seul manque | Message statique `GUIDED_STEP_REQUIREMENTS.establishment` | `backend/lib/schoolSetupGuided.js` | **Corrigé** (`details.missingFields`) |
| A1b | **P1** | Le Profil n'exige pas l'adresse et n'affiche pas la devise, alors que l'étape 1 les exige | Règle de l'étape 1 non reportée dans le formulaire | `web/src/pages/parametres/EstablishmentProfilePage.tsx` | **Corrigé** |
| A2 | **P1** | Faux échec de l'étape 1 : `currency: ""` dans le profil masque la devise du pays ; adresse et téléphone historiques (dans `profile_payload`) ignorés alors que l'API les affiche | `??` au lieu de `\|\|` ; lecture de la seule colonne | `schoolSetupGuided.js` | **Corrigé** (mêmes règles que `mapEstablishmentRow`) |
| A3 | **P1** | Faux succès des étapes 4, 5, 6, 8 et 10 après archivage ou retrait | Compteurs sans filtre de statut | `schoolSetupGuided.js` | **Corrigé** (compteurs de l'assistant uniquement ; LOT 0 intact) |
| A4 | **P1** | Le bouton de correction de l'étape 8 ouvre une page sans création de type d'évaluation (Web `/notes`, Mobile `TeacherGrades`) | Lien erroné | `web/src/lib/schoolSetupGuidedWeb.ts`, `Mobile/src/lib/schoolSetupGuidedMobile.ts` | **Corrigé** |
| A5 | P2 | `STEP_DEPENDENCY` ne dit pas quelle étape précédente bloque | Message générique | `schoolSetupGuided.js` | **Corrigé** (étape nommée, `details`) |
| A6 | **P1** | Mobile : aucun écran ne permet d'enregistrer les règles de notification, donc l'étape 9 ne peut pas être satisfaite depuis le Mobile | Écran absent ; le lien ouvre la boîte de réception | `Mobile/src/lib/schoolSetupGuidedMobile.ts`, nouvel écran | **Ouvert** : PR séparée proposée (écran natif sur `PATCH /api/backoffice/establishments/:code/notification-settings`, équivalent de `SettingsNotificationsPage`) |
| A7 | P2 | Mobile : une erreur de `GET /v2/school-setup/guided` est avalée, et l'écran revient silencieusement à l'ancien assistant 3/3 | `.catch(() => setGuided(null))` | `Mobile/src/screens/SchoolSetupSettingsScreen.tsx` | **Ouvert** : PR séparée, car ce fichier relève du périmètre contrôlé LOT 4 (L4-09) |

Observations, sans correctif, pour décision CTO :
- **O1.** L'étape 10 est satisfaite dès que l'administrateur lui-même existe, ce qui est toujours vrai pour qui ouvre l'assistant. C'est conforme au mandat (« au moins un utilisateur ») mais peu discriminant. Faut-il exiger un second compte ?
- **O2.** L'étape 7 compte une grille de frais quel que soit son statut (`Brouillon` compris) et son année. C'est conforme au mandat. Faut-il exiger une grille publiée et de l'année courante ?
- **O3.** Après finalisation, le statut « terminé » est conservé même si des données disparaissent, mais la progression affichée reste recalculée. C'est la décision CONFIG-FINAL-01, à confirmer.

## 5. Tests RED → GREEN

RED : les tests ont été exécutés sur le code de référence (`develop@4560495b`) avant le correctif. GREEN : sur `6f6fef9a`. Les logs, expurgés, sont dans `evidence/`.

| Test | Commande | RED (référence) | GREEN (`6f6fef9a`) |
|---|---|---|---|
| `backend/lib/schoolSetupGuided.audit10.pg.test.js` (PostgreSQL 16 réel, base jetable) | `DATABASE_URL=… node --test backend/lib/schoolSetupGuided.audit10.pg.test.js` | **7 échecs / 11** (`evidence/red-pg.txt`) | **11 / 11** (`evidence/green-pg.txt`) |
| `backend/lib/schoolSetupGuided.audit10.test.js` | `node --test backend/lib/schoolSetupGuided.audit10.test.js` | **4 échecs / 5** (`evidence/red-unit.txt`) | **5 / 5** |
| Régressions guidées (`red`, `regression`, `finalize`, `status.red`) | `node --test …` | — | **72 / 72** (`evidence/green-unit.txt`) |
| Web : `EstablishmentProfilePage.audit10.test.tsx` | `npx vitest run …` | **3 échecs / 4** (`evidence/red-web-profile.txt`) | **4 / 4** |
| Web : `schoolSetupGuidedWeb.red.test.ts` (W-AUDIT10-08) | `npx vitest run …` | **1 échec / 18** (`evidence/red-web-links.txt`) | **18 / 18** |
| Web : 7 fichiers guidés et Profil | `npx vitest run …` | — | **63 / 63** (`evidence/green-web.txt`) |
| Mobile : `schoolSetupGuidedMobile.red.test.ts` (M-AUDIT10-08) | `npx --yes tsx …` | **1 échec / 19** (`evidence/red-mobile.txt`) | **19 / 19** (`evidence/green-mobile.txt`) |
| Suite `npm run verify:school-setup-guided-green` | idem | — | **PASS** (`evidence/guided-green-suite.txt`) |
| Runner CI PostgreSQL (3 fichiers PG guidés) | `node scripts/backend-test-baseline.js pg --select=…` | — | **16 PASS / 0 FAIL** (`evidence/pg-runner.txt`) |
| Baseline backend unit complète | `node scripts/backend-test-baseline.js unit` | — | **2958 PASS / 0 FAIL / 3 SKIP** (préexistants) |
| Gate L4-09 | `npm run verify:school-setup-lot4-red` | — | **PASS**, L4-09 N/A (chantier guidé) (`evidence/gate-l409.txt`) |
| TypeScript Web et Mobile, ESLint | `tsc`, `eslint` | — | 0 erreur ; 1 avertissement préexistant (`EstablishmentProfilePage.tsx:63`, ligne non modifiée) |

Aucun test n'a été désactivé ou ignoré.

## 6. Matrice des preuves par étape

Légende :
- **A** : preuve automatisée sur PostgreSQL réel (AUDIT10-PG) ou en unitaire (B*, AUDIT10-U) ;
- **—** : non applicable ;
- **NV** : non vérifié dans cet audit.

P1 état initial non satisfait · P2 prérequis identifié · P3 correction · P4 réponse API · P5 validation · P6 persistance · P7 test · P8 Web et Mobile.

| # | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A (PG-01, U-01) | A (`missingFields`) | A (U-03) | A (409 + `details`) | A (U-03) | A (B3, B14) | A | Web **A** (Profil) ; Mobile : liens vérifiés, UI **NV** | PASS technique, smoke **NV** |
| 2 | A (B5) | A (`requirement`) | — | A | A (B13) | A | A | NV | PASS technique |
| 3 | A (PG-ISO) | A | — | A | A (PG-00) | A | A | NV | PASS technique |
| 4 | A (PG-04) | A | — | A | A (PG-00) | A | A | NV | PASS technique |
| 5 | A (PG-05, B11) | A | — | A | A (PG-00) | A | A | NV | PASS technique |
| 6 | A (PG-06, B12) | A | — | A | A (PG-00, PG-06b) | A | A | NV | PASS technique |
| 7 | A (PG-ISO) | A | — | A | A (PG-00) | A | A | NV | PASS technique |
| 8 | A (PG-08) | A | lien Web et Mobile **A** | A | A (PG-00) | A | A | liens Web et Mobile **A** | PASS technique |
| 9 | A (postsmoke #1171) | A | Web A (#1171) ; **Mobile impossible (A6)** | A | A | A | A | **Mobile KO (A6)** | **HOLD** |
| 10 | A (PG-10) | A | — | A | A (PG-00) | A | A | NV | PASS technique |

**Non fourni dans cet audit**, ce qui interdit de déclarer PASS au sens du mandat :
- captures avant et après de l'interface Web et Mobile ;
- smoke en préproduction : pas d'accès préproduction depuis ce conteneur ;
- vérification sur l'application native exécutée (seuls les sources, contrats et tests de l'application Expo ont été vérifiés).

## 7. Sécurité RBAC et multi-tenant

- **Tenant :** résolu par `principal.sub → users.school_id` (`resolveSchoolSetupTenant`). Aucun paramètre client. Toutes les requêtes de l'assistant sont filtrées par `school_id`. La nouvelle jointure des inscriptions exige que la classe appartienne au même établissement que l'élève.
- **Isolation :** prouvée sur PostgreSQL (AUDIT10-PG-ISO). Un établissement vide ne profite pas des données d'un établissement complet. B8 prouve qu'aucune lecture ni écriture n'est possible entre établissements.
- **Écriture :** les permissions `Paramètres Établissement:UPDATE`, `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES` et `Gérer établissements` sont inchangées (B9 : 403 sans permission). Aucune route ajoutée ou modifiée.
- **Superadmin :** aucun accès global ajouté. L'assistant reste fermé sans `users.school_id` (403).
- **Inchangés :** aucun stockage parallèle, aucune migration, aucune validation backend retirée (les conditions sont au contraire plus strictes). Le verrou NFC, la CI et les tests sont inchangés.

## 8. PR et périmètre

PR Draft vers `develop`. Périmètre fichier par fichier :

| Fichier | Nature |
|---|---|
| `backend/lib/schoolSetupGuided.js` | Correctif A1, A2, A3, A5 |
| `backend/lib/schoolSetupGuided.audit10.test.js` | Test unitaire (nouveau) |
| `backend/lib/schoolSetupGuided.audit10.pg.test.js` | Test PostgreSQL (nouveau) |
| `web/src/pages/parametres/EstablishmentProfilePage.tsx` | Correctif A1b |
| `web/src/pages/parametres/EstablishmentProfilePage.audit10.test.tsx` | Test Web (nouveau) |
| `web/src/lib/schoolSetupGuidedWeb.ts` | Correctif A4 (lien et texte de l'étape 8) |
| `web/src/lib/schoolSetupGuidedWeb.red.test.ts` | Test W-AUDIT10-08 ajouté |
| `Mobile/src/lib/schoolSetupGuidedMobile.ts` | Correctif A4 Mobile |
| `Mobile/src/lib/schoolSetupGuidedMobile.red.test.ts` | Test M-AUDIT10-08 ajouté |
| `docs/audit/setup-guided-10-01/**` | Ce rapport et les preuves |

Aucun fichier LOT 0 (`schoolSetupStatus.js`) ni LOT 4, aucune migration, aucun module sans lien.

## 9. Plan pour la suite

1. Diff CTO indépendant de cette PR, puis CI complète (`Required`).
2. PR séparée A6 : écran Mobile natif « Règles de notification », en parité avec `SettingsNotificationsPage`, et lien de l'étape 9.
3. PR séparée A7 : afficher l'erreur de l'assistant guidé sur Mobile au lieu de revenir à l'ancien assistant (périmètre L4-09 à traiter).
4. Décisions CTO sur O1, O2 et O3.
5. Smoke en préproduction des 10 étapes, Web et Mobile natif, avec captures. Puis, sur GO, requête §2 en lecture seule pour l'établissement concerné.

## 10. Verdict

**HOLD.** Les défauts A1 à A5 sont corrigés et prouvés par des tests RED puis GREEN, dont 11 sur PostgreSQL réel. Les conditions de clôture du mandat ne sont pas encore réunies :
- A6 : l'étape 9 est impossible sur le Mobile ;
- A7 : une erreur reste masquée sur le Mobile ;
- les captures et le smoke en préproduction ne sont pas faits ;
- le diff CTO et la CI sur la PR restent à obtenir.

`AUDIT-SETUP-GUIDED-10-01 — DRAFT / HOLD — AUCUN MERGE NI DÉPLOIEMENT SANS GO CTO.`
