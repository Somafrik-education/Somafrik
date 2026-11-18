# AUDIT-PARITE-WEB-MOBILE-PROD-01 — Parité Web / Mobile / Production

- **Date** : 2026-11-18
- **Nature** : audit en lecture seule (phase 1). Aucune source produit modifiée, aucun merge, aucun déploiement.
- **Référence `develop`** : `8467944526563b956bfd50370079af9e9355b533`
- **Référence `main`** : `e223e30e9e195dabff01e66a81afdf0164486dc2`
- **Règle** : aucune conformité n'est affirmée sans preuve. Tout ce qui n'a pas pu être observé est marqué **NON VÉRIFIÉ**.

---

## 1. Synthèse exécutive

1. **Code : `main` et `develop` ont le même contenu.** `develop@8467944` est un ancêtre de `main@e223e30` et `git diff develop main` est vide. Promotion v25 : #1191. Aucun correctif présent sur `develop` ne manque sur `main`.
2. **Les écarts constatés sur le terrain viennent surtout des artefacts déployés, pas du code** (catégorie B). Trois raisons :
   - **Web préproduction en retard sur l'API.** L'API préprod exécute `78a7749`, la tête de branche de #1189, au contenu identique à `develop`. Le frontend Web préprod ne contient pas les écrans de #1189 (révocation de sécurité NFC). Il a été construit entre #1183 (présent) et #1189 (absent).
   - **Déploiements faits depuis une branche de PR.** L'API préprod tourne sur `fix/nfc-p0-r3-3-prevention` (`78a7749`), pas sur un commit de `develop`. Le contenu est le même, mais la traçabilité est rompue.
   - **Artefacts Android ambigus.** « v25 » désigne plusieurs binaires : l'APK de test local `99cb791`, avec le versionCode `25` d'`app.json`, et les AAB EAS production `e223e30`, en versionCode distant 24 et 27. Au moins un build EAS (versionCode 25 ou 26) a été produit hors GitHub Actions, depuis un commit inconnu. On ne sait pas quel binaire est installé chez les testeurs : **NON VÉRIFIÉ**.
3. **Production (Web et API) : NON VÉRIFIÉ.** Ces hôtes sont refusés par la politique réseau de l'environnement d'audit.
4. **Finances « Imputé / Non imputé » : conforme à la décision #1041** sur `develop`, en Web préprod et dans l'APK `99cb791`. Le terme restant est la **valeur persistée** de l'API, conservée volontairement. Si des écrans montrent encore « Non imputé », la cause la plus probable est un **binaire antérieur au 2026-11-02** (catégorie B), ou la production non vérifiée.
5. **Formulaires Parent : écarts réels Web / Mobile** (catégories A et F), décrits en §5.
6. **Écrans Élève blancs sur Android : non reproduits.** Cause racine non établie (catégorie G, P0). Le parcours complet est OK en build release Web, y compris avec le cache L1 activé. La reproduction sur émulateur Android était prête mais a été interrompue avant exécution.
7. **Les contrôles automatiques de parité (LOT 0–8, Core, RBAC HTTP live, NFC Android) sont verts** sur le contenu déployé. Ils contrôlent les contrats et le source, pas le rendu sur appareil : ils ne peuvent pas détecter un écran blanc Android.

**Verdict : NO-GO Production.** Il reste un P0 ouvert (parcours Élève Android) et les artefacts réellement distribués ne sont pas identifiés.

---

## 2. Traçabilité versions et déploiements

| Cible | Commit observé | Contenu = `develop@8467944` ? | Preuve | Statut |
|---|---|---|---|---|
| `develop` | `8467944` (2026-11-17, #1189) | — | `git rev-parse origin/develop` | Référence |
| `main` | `e223e30` (#1191, release v25) | **Oui** (diff vide) | `git merge-base` = `8467944` ; `git diff develop main` vide | Conforme |
| API préproduction | `78a7749` (`refs/heads/fix/nfc-p0-r3-3-prevention`, tête de #1189) | **Oui** (diff vide) | `GET https://api-preprod.somafrik.app/api/health` → `gitSha` ; `git diff 78a7749 develop` vide | Conforme en contenu, **traçabilité rompue** (branche de PR) |
| Web préproduction (`preprod.somafrik.app`) | non exposé ; encadré par marqueurs | **Non** : manque #1189 | 144 chunks Vite téléchargés. Chaînes de #1183, #1174, #1171, #1124 présentes. Chaînes ajoutées par #1189 dans `StudentCardTab.tsx` (« Confirmer la révocation de sécurité », « Révocation de sécurité », « Annulation administrative… ») absentes, alors que les chaînes du même fichier avant #1189 sont présentes | **Écart B** |
| API production (`api.somafrik.app`) | — | — | Hôte refusé par le proxy de l'environnement d'audit | **NON VÉRIFIÉ** |
| Web production (`somafrik.app`) | — | — | Idem | **NON VÉRIFIÉ** |
| AAB EAS production #2 | `e223e30`, versionCode **24**, appVersion 1.2.1, profil `production` | Oui | Run Actions `eas-production-aab.yml` #2 (2026-11-17 20:09) ; sha256 `988a45d3…963fbf28` | Construit, **distribution NON VÉRIFIÉE** |
| AAB EAS production #3 | `e223e30`, versionCode **27**, profil `production` | Oui | Run #3 (2026-11-17 22:15), job 134410473172 ; sha256 `e236ddcf…8359fd89` ; artefact 14378610942 | Construit, **distribution NON VÉRIFIÉE** |
| Builds EAS versionCode 25 / 26 | inconnu | inconnu | Le compteur distant passe de 24 à 26 entre les runs #2 et #3, sans run GitHub correspondant | **NON VÉRIFIÉ** (build hors CI) |
| APK test « AUTH-MOBILE-01 » | `99cb791`, versionCode 25 (`app.json`), profil `preview`, arm64, signature debug | Non : 11 commits de retard, dont #1175, #1176, #1182, #1189 | sha256 `86379992…5188347` | Artefact de test, **jamais distribuable** |
| Google Play (piste interne / production) | — | — | Aucun accès console ; le workflow ne fait pas d'`eas submit` | **NON VÉRIFIÉ** |

**Conséquence.** Une correction mergée sur `develop` n'est disponible que si :
- le frontend Web a été reconstruit et redéployé (ce n'est pas le cas pour #1189 en préprod) ;
- le binaire Android installé est issu d'un commit qui la contient. Ce n'est pas le cas pour l'APK `99cb791`, et c'est non vérifié pour les autres.

---

## 3. Corrections mergées mais absentes d'au moins un artefact

| PR | Merge sur `develop` | Web préprod | API préprod | APK test `99cb791` | AAB EAS `e223e30` | Production |
|---|---|---|---|---|---|---|
| #1189 révocation sécurité NFC (Web + Android) | `8467944` | **Absent** | Présent | **Absent** | Présent | NON VÉRIFIÉ |
| #1175 réglages notifications établissement (setup étape 9, Mobile) | `db15559` | n/a | Présent | **Absent** | Présent | NON VÉRIFIÉ |
| #1176 erreurs de chargement du setup guidé (Mobile) | `4d5a32a` | n/a | Présent | **Absent** | Présent | NON VÉRIFIÉ |
| #1183 rôle Administrateur scolaire à la création (Web) | `93f98e4` | Présent | Présent | n/a | n/a | NON VÉRIFIÉ |
| #1171 erreurs réglages carte et notifications (Web) | `4560495` | Présent | Présent | Présent | Présent | NON VÉRIFIÉ |
| #1041 retrait « Imputé / Non imputé » des écrans | `1f36fa7` (2026-11-02) | Présent | n/a | Présent | Présent | NON VÉRIFIÉ |
| #1169 connexion Élève par mot de passe (Mobile) | `99cb791` | n/a | n/a | Présent | Présent | NON VÉRIFIÉ |

---

## 4. Finances — « Imputé / Non imputé »

### Décision de référence
**#1041** (mergée, `1f36fa72`) porte uniquement sur la présentation. Elle fait suite à #1036, qui a retiré l'encaissement « Non imputé » du formulaire, et à #1037, l'audit du vocabulaire (non mergé). Selon #1041 :

> Le statut persisté, `feeType` et les champs API (`allocatedAmount`, `unallocatedAmount`, `__unallocated__`) ne changent pas. Aucune migration.

| Ancien texte d'écran | Texte de référence |
|---|---|
| `Non imputé` | Non affecté |
| `Partiellement imputé` | Encaissement partiel |
| `Montant imputé` | Affecté aux frais ouverts |
| `Montant non imputé` / ligne de reçu `Non imputé` | Non affecté à un frais |
| `Trop-perçu` | inchangé |

### État constaté
| Surface | Résultat | Preuve |
|---|---|---|
| Web `develop` | Conforme : traduction centralisée | `web/src/lib/financeObligationStatus.ts:41,53`. Les `StatusBadge` à statut brut ne concernent que les abonnements SaaS et les grilles de frais, pas les paiements établissement |
| Mobile `develop` | Conforme : traduction centralisée | `Mobile/src/lib/financeObligationStatus.ts:41,53` ; `Mobile/src/components/PaymentReceiptCard.tsx:70` via `financeScreenFeeLabel` |
| Web préprod déployé | Conforme | Chunks : « Non affecté à un frais », « Affecté aux frais ouverts », « Encaissement partiel » présents ; « Montant imputé », « Montant non imputé », « Partiellement imputé » absents |
| APK test `99cb791` | Conforme | Bundle Hermes : nouveaux libellés présents. La seule occurrence de « Non imputé » est la constante `UNALLOCATED_FEE_TYPE`, qui n'est jamais affichée et sert de garde d'écriture (`Mobile/src/lib/paymentEnrollment.ts:158,399,411`) |
| API / backend | Valeur persistée « Non imputé » conservée (contrat) | `backend/lib/financeUnallocatedCash.js:22`, `backend/lib/financeWebMobileWriteContract.js:10`, `web/src/lib/quickPayment.ts:354,360` (valeur envoyée à l'API) |
| Message backend visible possible | Risque P2 | `backend/lib/financeDomainInvariants.js:125` : « Conservation paiement violée : imputé + non imputé ≠ montant. » Ce message peut s'afficher si l'invariant est rompu |
| Production | NON VÉRIFIÉ | Hôtes inaccessibles |

### Conclusion
- Aucune suppression de donnée, de statut ni de règle comptable n'est nécessaire, et aucune n'est recommandée.
- Si « Imputé / Non imputé » est encore visible, il faut d'abord identifier le binaire ou le déploiement concerné. Tout artefact antérieur au 2026-11-02 affiche l'ancien vocabulaire.
- Décision CTO à prendre : faut-il aussi renommer le message d'invariant backend (P2) ? Ce serait une correction de texte uniquement.

---

## 5. Formulaires Parent — Web / Mobile

### 5.1 Lier ou créer un parent depuis la fiche élève
| Élément | Web (`web/src/components/students/StudentGuardiansTab.tsx`) | Mobile (`Mobile/src/screens/StudentDetailScreen.tsx`) | Écart |
|---|---|---|---|
| Titre de la section | « Lier un parent » (l.143) | Bouton « Lier un responsable » (l.499) | F (libellé) |
| Prénom | « Prénom » (l.148) | « Prénom du parent » (l.485-486) | F |
| Nom | « Nom » (l.153) | « Nom du parent » (l.487-488) | F |
| Téléphone | « Téléphone » (l.158) | « Téléphone du parent » (l.489-490) | F |
| **E-mail** | « E-mail » (l.163) | **Absent** | **A** : un parent identifiable seulement par e-mail ne peut pas être lié depuis le Mobile. Le client API Mobile accepte pourtant `email` (`Mobile/src/services/api.ts:593-603`) |
| Validation locale | « Renseignez un téléphone ou un e-mail pour identifier le parent. » (l.70) | Aucune : le téléphone est envoyé même vide (l.275-280) | **A / D** : sur Mobile, l'erreur vient du serveur |
| Bouton | « Créer ou lier le parent » | « Lier un responsable » | F |
| Affichage des accès temporaires | Bloc « Accès provisoires — affichage unique » | Alerte « Accès parent créés » avec identifiant et mot de passe (`Mobile/src/lib/parentLinkingPresentation.ts:29-32`) | Parité fonctionnelle, textes différents (F) |
| Badges de rôle des responsables | « Principal », « Responsable légal », « Responsable financier » (`web/src/lib/studentGuardianViewModel.ts:85-91`) | Absents de la fiche élève (seule la carte élève affiche « Responsable principal ») | **A** |

### 5.2 Champs parent lors de la création ou de l'inscription d'un élève
| Élément | Web | Mobile (`Mobile/src/components/StudentMutationControls.tsx`) | Écart |
|---|---|---|---|
| Téléphone | « Téléphone parent » (`web/src/pages/etablissement/ClassStudentsPage.tsx:305`, `web/src/lib/entityModules.ts:303`) | « Téléphone du parent » (l.251) | F |
| E-mail | « Email parent » (`ClassStudentsPage.tsx:319`) | Absent | A |
| Nom du parent | « Parent » / « Nom du parent » (`entityModules.ts:302`) | Absent | A |

### 5.3 Référence métier
Je n'ai trouvé **aucune référence de libellés validée** dans le dépôt. `docs/user-guides/GUIDE-UTILISATEUR-MOBILE.md:138` cite « Téléphone du parent » (formulation Mobile). Le chantier transverse ouvert **#1126 « UX-COPY-01 » (GELÉ / HOLD)**, avec la PR #1127, couvre les textes métier Web et Mobile.

**À décider par le CTO** : quels libellés font référence (« Parent » ou « Responsable », formes courtes ou longues). Je ne propose aucun libellé tant que ce n'est pas tranché, et le lot doit être coordonné avec #1126 pour éviter un doublon.

### 5.4 Non couvert
Consultation et modification d'un parent existant, parent lié à plusieurs élèves, permissions détaillées par rôle : **NON VÉRIFIÉ** dans cet audit.

---

## 6. Parcours Élève Android — écrans blancs (P0)

**Signalement CTO** : sur l'APK v25 préprod, le tableau de bord Élève fonctionne. Notes, Présences, Emploi du temps, Cours, Bulletins, Paiements, Messages et Profil sont blancs.

### Établi
| Constat | Preuve |
|---|---|
| Avant #1169, aucun Élève ne pouvait se connecter sur Mobile (« Champs manquants »), donc les rubriques Élève étaient inaccessibles sur les APK depuis #1116. Le défaut a pu exister sans être visible. | Analyse de #1169 (`platformLogin.ts` envoyait `pin` pour `student`) |
| #1169 n'a modifié aucun écran Élève ni la navigation. | Liste des fichiers de #1169 |
| Depuis `99cb791`, seul #1175 a touché la navigation, avec +5 lignes dans `AppNavigator.tsx` pour l'écran de configuration. | `git log 99cb791..develop -- Mobile/src/navigation …` |
| Build **release** de l'application au commit `99cb791`, API locale réelle (PostgreSQL 16, données de démo), compte Élève réel : connexion, Accueil, Profil, Notes, Présence, Frais, Bulletins, Messages, Annonces, Notifications, Hors ligne et Support **s'affichent avec leurs données, sans exception JS**. Même chose avec le cache L1 (SQLCipher simulé par `memoryStore`) activé comme sur Android. | Reproduction Chromium décrite dans le compte rendu de session. Les seuls bouchons concernent les modules natifs absents sur le Web (NFC, SecureStore) |
| La session Élève déclenche des appels refusés en 403 : `/teachers`, `/courses`, `/assignments`, `/backoffice/users`, `/backoffice/subscriptions`, `/backoffice/countries`, `/backoffice/establishments/:id`, `/v2/school-setup/guided`. | Journal réseau de la reproduction. Ce n'est pas la cause : l'affichage tient malgré ces refus. C'est un défaut de requêtes inutiles (P2) |
| L'identité Élève vient de `linkedStudent.studentId` (`resolveSessionStudentId`) et la session de connexion la contient. | `Mobile/src/lib/canonicalStudentIdentity.ts:46-56` ; réponse `/api/login` |
| Le défaut « route prioritaire sur l'identité » pour `student` est traité par **#1141** (ouverte, Draft). C'est un sujet de sécurité, pas d'écran blanc. | #1141 |

### Hypothèses restantes (non vérifiées)
1. **H1, rendu natif de la navigation.** Toutes les rubriques en échec sont des **navigations hors de l'état initial** : onglets `Profil`, `Notes`, `Presences`, `FraisEleve`, et écrans de pile `StudentDetail`, `StudentNotes`, `Messages`, `ReportCards`, `Timetable`. Sur le Web, `native-stack` et les écrans sont simulés en JS, donc un défaut propre à `react-native-screens` sous Android y est invisible.
2. **H2, exception propre à Hermes** (API JS indisponible dans Hermes mais présente dans V8).
3. **H3, données de préproduction**, par exemple un compte Élève sans `linkedStudent` ou des notes réelles mal formées. Moins probable : les écrans affichent alors « Élève introuvable » et non un écran vide.
4. **H4, état local résiduel** : cache L1 ou session d'un autre rôle ou d'un autre établissement sur le même téléphone.

### Reproduction prête, à reprendre sur autorisation
- Émulateur Android 12 x86_64 en mode logiciel (pas de KVM) ;
- APK `preview` x86_64 construit depuis `99cb791` : même configuration que la v25 (`https://api-preprod.somafrik.app`, Hermes, R8) ;
- table de chaînes UTF-16 identique au bundle v25 (855/855) ;
- résolution de l'hôte préprod vers l'API locale et AC de test dans le magasin système (émulateur jetable uniquement).

L'exécution a été interrompue avant le premier parcours. Les outils doivent être reconstruits dans le nouvel environnement (environ 30 min). Sinon, un `logcat` provenant d'un appareil réel trancherait directement.

---

## 7. Matrice de traçabilité

Légende : C = Conforme · E = Écart · NV = Non vérifié · n/a = non applicable.

| ID | Module | Rôle | Attendu | Web develop | Mobile develop | Web prod | Mobile prod | Backend | PR d'origine | SHA | Cause | Prio | Preuve | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| APW-001 | Navigation Élève | Élève | Chaque rubrique s'ouvre avec chargement, données, vide ou erreur explicite | C (n/a) | NV : OK en Web release, non observé sur Android | n/a | NV | `/api/login` fournit `linkedStudent` | — | `99cb791` | **G** | **P0** | §6 | Reproduire sur émulateur ou `logcat`, puis corriger |
| APW-002 | Déploiement Web | Tous | Web préprod = commit déployé de l'API | E : #1189 absent | n/a | NV | n/a | API préprod = `78a7749` | #1189 | `8467944` | **B** | P1 | §2 | Redéployer le Web préprod depuis `develop@8467944` |
| APW-003 | Gouvernance déploiement | — | Déploiement depuis `develop` ou `main`, SHA exposé | E : aucun SHA exposé par le Web | n/a | NV | n/a | API préprod = branche de PR | #1189 | `78a7749` | **C** | P1 | §2 | Déployer uniquement depuis `develop`/`main` ; exposer le SHA du build Web |
| APW-004 | Artefacts Android | Tous | Un versionCode correspond à un commit unique, connu | n/a | E | n/a | NV | — | #1191 | `e223e30` | **C** | **P0** (avant GO) | §2 : `app.json` 25 contre EAS 24/27 ; builds 25/26 hors CI | Registre des builds ; retirer `versionCode` d'`app.json` ou l'aligner ; identifier le binaire distribué |
| APW-005 | Finances, libellés | Admin, Comptable, Parent, Élève | Aucune mention « Imputé / Non imputé » à l'écran (#1041) | C | C | NV | NV | Valeur persistée conservée (contrat) | #1041 | `1f36fa7` | — (B si binaire < 2026-11-02) | P1 | §4 | Identifier l'artefact qui affiche encore le terme |
| APW-006 | Finances, message backend | Admin, Comptable | Pas de terme technique visible | n/a | n/a | NV | NV | `financeDomainInvariants.js:125` | — | `8467944` | F | P2 | §4 | Texte uniquement, après décision |
| APW-007 | Parents, lier un parent | Admin, Secrétaire | Mêmes champs (téléphone **ou** e-mail) | C (référence) | **E** : pas d'e-mail | NV | NV | `POST /parents/link` accepte `email` | — | `8467944` | **A** | P1 | §5.1 | Ajouter l'e-mail et la validation locale sur Mobile |
| APW-008 | Parents, libellés | Admin, Secrétaire | Libellés identiques, référence validée | E | E | NV | NV | n/a | #1126 (gelée) | — | **F** | P1 | §5.1-5.2 | Décision CTO sur la référence, puis lot coordonné avec #1126 |
| APW-009 | Parents, badges | Admin, Secrétaire | Principal, légal et financier visibles | C | **E** : absents | NV | NV | Données exposées | — | `8467944` | **A** | P1 | §5.1 | Afficher les badges sur la fiche élève Mobile |
| APW-010 | Élèves, inscription (parent) | Admin, Secrétaire | Mêmes champs parent | C | **E** : pas d'e-mail ni de nom du parent | NV | NV | — | — | `8467944` | **A** | P1 | §5.2 | À trancher avec APW-008 |
| APW-011 | NFC, révocation de sécurité | Admin | Disponible Web et Android | C | C | NV | NV | Présent (préprod) | #1189 | `8467944` | B (Web préprod, APK test) | P1 | §3 | Couvert par APW-002 et APW-004 |
| APW-012 | Identité Élève par route | Élève | Une route ne remplace jamais l'identité authentifiée | n/a | E | n/a | NV | Le serveur reste l'autorité | #1141 (ouverte) | — | Sécurité | P1 | #1141 | Poursuivre #1141, ne pas dupliquer |
| APW-013 | Requêtes hors droits | Élève | Aucun appel vers des ressources non autorisées | n/a | E (403 multiples) | n/a | NV | 403 correct | — | `99cb791` | D / F | P2 | §6 | Conditionner les chargements aux droits effectifs |
| APW-014 | Parité automatisée LOT 0–8 | Tous | Contrats verts | C | C | NV | NV | C | #705-#714 | `78a7749` (contenu = `develop`) | — | — | Check-runs « LOT 0…8 parity », « Core tests », « RBAC HTTP live API » en succès | Ajouter un contrôle de rendu sur appareil (cf. APW-001) |
| APW-015 | Modules Auth, Tableau de bord, Utilisateurs, Enseignants, Notes, Présences, EDT, Bulletins, Communication, Paramètres, Carte Élève, Support, par rôle (Superadmin, Admin scolaire, Préfet, Secrétaire, Enseignant, Parent) | — | Parité fonctionnelle | NV | NV | NV | NV | — | Baseline `docs/audits/web-mobile-parity-final-2026-09-19.md` (« CLOSED GLOBAL ») | `0d5a3ae` | **G** | P1 | Non rejoué de bout en bout dans cet audit | Recette par rôle sur artefacts identifiés (lot P1-E) |

---

## 8. Plan de rattrapage proposé (phase 2, sur autorisation CTO)

| Lot | Contenu | IDs | PR estimées | Dépendances | Risques | Tests requis |
|---|---|---|---|---|---|---|
| **P0-A, écrans blancs Élève Android** | Reproduction sur émulateur ou `logcat` réel, cause racine, correctif à la source, états explicites | APW-001 | 1 (+1 doc si le cas d'erreur est générique) | Accès à un appareil ou reprise de l'émulateur | Correctif à l'aveugle sans preuve (interdit) | Rendu de chaque rubrique Élève, données vides, 403, aller-retour ; non-régression Parent / Enseignant / Admin ; smoke APK |
| **P0-B, identification des artefacts** | Registre « commit → versionCode → artefact → canal » ; aligner la source du versionCode ; exposer le SHA du Web | APW-003, APW-004 | 1 (CI / doc) | Accès EAS et Play Console (CTO) | Collision de versionCode sur le Play Store | Vérification du SHA du bundle ; contrôle CI du versionCode |
| **P1-A, livraison des correctifs mergés** | Redéployer le Web préprod depuis `develop@8467944` ; reconstruire l'APK de validation depuis le HEAD | APW-002, APW-011 | 0 (opérations) | P0-B | Écart Web / API sur les flux NFC | Marqueurs #1189 présents dans les chunks ; smoke Web NFC |
| **P1-B, formulaires Parent** | E-mail et validation locale sur Mobile, badges de responsables, libellés selon la décision | APW-007 à APW-010 | 2 (fonctionnel, puis libellés) | Décision CTO sur la référence ; coordination avec #1126 | Doublon avec #1127 | Contrats Mobile `/parents/link` (téléphone **ou** e-mail), rendu des badges, `verify-mobile-form-fields` |
| **P1-C, Finances** | Aucun changement de calcul ; identifier l'artefact fautif ; message d'invariant (option) | APW-005, APW-006 | 0 à 1 | Identification de l'artefact | Toucher au contrat persisté (interdit) | `verify-finance-web-mobile-convergence.js` ; Vitest reçus |
| **P1-D, sécurité identité Élève** | Finaliser #1141 | APW-012 | 0 (PR existante) | P0-A, pour ne pas mélanger les sujets | — | Tests de #1141 |
| **P1-E, recette par rôle** | Recette Web et Mobile par rôle et par module sur les artefacts identifiés | APW-015 | 0 (documentaire) puis selon constats | P0-B, P1-A | Constats tardifs | Matrice signée par rôle |
| **P2, finitions** | Appels hors droits Élève, harmonisation des textes | APW-006, APW-013 | 1 à 2 | — | Faible | Journal réseau sans 403 inutile |

## 9. Critères de GO Production
1. P0-A résolu, avec preuve : cause racine documentée et smoke Android de toutes les rubriques Élève sur un APK issu du HEAD validé.
2. P0-B : le binaire Android candidat est identifié par son SHA, son versionCode et son canal, avec un versionCode unique.
3. Web et API de production vérifiés : SHA exposé, égal au commit validé.
4. Marqueurs des correctifs mergés présents dans les artefacts candidats (cf. §3).
5. Recette par rôle (P1-E) sans écart P1 ouvert, ou écarts acceptés explicitement par le CTO.

## 10. Limites de l'audit
- Production non accessible depuis l'environnement d'audit (politique réseau).
- Aucun accès Play Console ni EAS : canal de distribution non vérifié.
- Aucun appareil Android ni journal `logcat` réel.
- Parcours par rôle autres qu'Élève non rejoués de bout en bout.
