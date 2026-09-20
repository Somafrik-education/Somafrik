# Matrice de couverture métier vs E2E

**SHA :** `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8`  
**Règle :** l’absence d’un test n’est jamais une réussite.

**Après exécution :** les colonnes « Statut exécution » ci-dessous qui restaient « NON TESTÉ » pour les chaînes HTTP `verify:e2e-*` et le mobile 0017+ sont désormais **FAIL-DATA** (401 / seed). Les isolées PG listées dans `execution-report.md` sont **PASS vérifié**. Aide / wizard / logout / push restent **NOT-COVERED**. Ne pas lire un FAIL-DATA comme un PASS du métier sous-jacent.

## 1. Authentification / sécurité

| Parcours métier | E2E trouvé | Surface | ID | Couverture Web/Mobile | Statut exécution |
| --------------- | ---------- | ------- | -- | --------------------- | ---------------- |
| Connexion Superadmin | oui | API | E2E-API-ONBOARD | API seulement | NON TESTÉ |
| Connexion Administrateur établissement | oui | API + Mobile web + Maestro | E2E-API-ONBOARD, E2E-API-0014, E2E-MOB-0017, E2E-MAE-01 | Web API + Mobile web ; Mobile natif NOT-RUNNABLE | NON TESTÉ |
| Connexion Enseignant | oui | API + Mobile web | E2E-API-0006, E2E-API-0013, E2E-MOB-0017 | Web API + Mobile web | NON TESTÉ |
| Connexion Parent/Élève | oui | API + Mobile web | E2E-API-0012, E2E-MOB-0017 | Parent API + Mobile web ; élève UI limitée | NON TESTÉ |
| Mauvais identifiants | partiel | Mobile web | E2E-MOB-0018 | Mobile web seulement (PIN) | NON TESTÉ |
| Mauvais code établissement | partiel | Mobile web | E2E-MOB-0018 | Mobile web seulement | NON TESTÉ |
| Séparation tenant | partiel | API / Web bulletins / COM | E2E-API-0012, E2E-WEB-REPORTCARD-S1, E2E-API-COM-C* | pas de journey Superadmin UI cross-school | NON TESTÉ |
| Session expirée | **non** | — | — | aucun E2E | NOT-COVERED |
| Logout | **non** | — | — | aucun E2E | NOT-COVERED |
| Droits RBAC | partiel | API / planning / bulletins / COM | E2E-API-0013, E2E-API-0028, E2E-WEB-PLANNING, E2E-WEB-REPORTCARD-S1 | pas de matrice UI Superadmin | NON TESTÉ |
| Accès interdit entre établissements | partiel | bulletins S1 + COM | E2E-WEB-REPORTCARD-S1, E2E-API-COM-C* | Web Playwright bulletins ; pas de chaîne 000x dédiée | NON TESTÉ |
| Changement de mot de passe obligatoire | partiel (helper login) | API helper | `e2e-api-helpers.js` `mustChangePassword` | pas de scénario autonome | NOT-COVERED (pas de suite dédiée) |

**Parcours métier identifiés :** 12  
**Parcours couverts par E2E (présent, même partiel) :** 9  
**Parcours sans E2E :** 3 (session expirée, logout, change-password dédié)  
**Taux indicatif :** 9/12 ≈ 75 % présence — **0 % PASS vérifié** avant exécution

## 2. Configuration établissement

| Parcours métier | E2E trouvé | Surface | ID | Statut exécution |
| --------------- | ---------- | ------- | -- | ---------------- |
| Création / configuration initiale | oui | API + in-memory | E2E-API-ONBOARD, E2E-BE-ESTABLISHMENT | NON TESTÉ |
| Informations établissement | partiel | in-memory | E2E-BE-ESTABLISHMENT | NON TESTÉ |
| Année scolaire | partiel | helper `setupActiveSchool` | E2E-API-* | NON TESTÉ |
| Référentiels | **non** (hors unit `verify:education-reference-data`) | — | — | NOT-COVERED |
| Setup wizard guidé | **non** (tests red/green unitaires seulement) | — | — | NOT-COVERED |

**Parcours identifiés :** 5 · **couverts :** 3 · **sans E2E :** 2 · **taux présence :** 60 % · **PASS vérifié :** 0

## 3. Classes

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Création | oui | E2E-API-0004, E2E-API-0014 | NON TESTÉ |
| Modification | partiel | E2E-API-0004 | NON TESTÉ |
| Consultation / liste | oui | E2E-API-0004, E2E-MOB-0020, E2E-MAE-04 | NON TESTÉ / Maestro BLOCKED |
| Classe active/inactive | oui | E2E-API-0004 | NON TESTÉ |
| Professeur principal | **non** | — | NOT-COVERED |
| Affectation élèves | oui | E2E-API-0005 | NON TESTÉ |
| Isolation établissement | partiel | COM / sync / 0005 scope | NON TESTÉ |

**Parcours identifiés :** 7 · **couverts :** 5 · **sans E2E :** 2 · **taux présence :** 71 %

## 4. Élèves

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Création flux canonique | oui | E2E-API-0005 | NON TESTÉ |
| Consultation / fiche | oui | E2E-API-0005, E2E-MOB-0020/0023 | NON TESTÉ |
| Modification autorisée | partiel | E2E-API-0005 | NON TESTÉ |
| Archivage / suppression | **non** | — | NOT-COVERED |
| Rattachement classe | oui | E2E-API-0005 | NON TESTÉ |
| Matricule | partiel | E2E-API-0005 | NON TESTÉ |
| Parent / responsable | oui | E2E-API-0005, E2E-API-0012 | NON TESTÉ |
| Visibilité Web/Mobile | partiel API + Mobile web | 0005 / 0020 / 0023 | NON TESTÉ ; natif BLOCKED |

**Parcours identifiés :** 8 · **couverts :** 7 · **sans E2E :** 1

## 5. Enseignants

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Création | oui (contacts-first) | E2E-API-0006 | NON TESTÉ / OBSOLETE possible |
| Consultation | partiel | E2E-MAE-06, E2E-API-0014 | NON TESTÉ |
| Affectations | oui | E2E-API-0006, E2E-API-0028 | NON TESTÉ |
| Matières / cours | partiel | E2E-API-0028 | NON TESTÉ |
| Professeur principal | **non** | — | NOT-COVERED |
| Isolation tenant | partiel | 0006 scope enseignant | NON TESTÉ |

**Parcours identifiés :** 6 · **couverts :** 5 · **sans E2E :** 1

## 6. Matières / cours

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Création | partiel | E2E-API-0028 / planning web | NON TESTÉ |
| Unicité scope établissement | **non** (unit/pg seulement) | — | NOT-COVERED |
| Affectation classes | partiel | E2E-API-0006 / 0028 | NON TESTÉ |
| Affectation enseignants | oui | E2E-API-0006 | NON TESTÉ |
| Lecture | partiel | planning web | NON TESTÉ |
| Suppression / désactivation | **non** | — | NOT-COVERED |

**Parcours identifiés :** 6 · **couverts :** 4 · **sans E2E :** 2

## 7. Présences

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Appel | oui API | E2E-API-0013, E2E-API-0014 | NON TESTÉ |
| Présent / Absent / Retard / Justifié | partiel API ; Maestro mutation DISABLED | 0013 / E2E-MAE-12 | NON TESTÉ / SKIPPED-EXISTING mutation |
| État par défaut | **non** | — | NOT-COVERED |
| Modification | partiel | 0013 | NON TESTÉ |
| Statistiques | partiel Maestro home | E2E-MAE-02 | BLOCKED device |
| Parité Web/Mobile | **non** en E2E live | parité unit seulement | NOT-COVERED |

**Parcours identifiés :** 6 · **couverts :** 3 · **sans E2E :** 3

## 8. Notes / pédagogie

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Création évaluation | oui | E2E-API-0008, E2E-API-0013 | NON TESTÉ |
| Saisie notes | oui | E2E-API-0008 | NON TESTÉ |
| Consultation | oui | E2E-API-0008, E2E-API-0012, E2E-MOB-0023 | NON TESTÉ |
| Moyennes | oui | E2E-API-0008 | NON TESTÉ |
| Bulletin / résultat | oui Playwright S1 | E2E-WEB-REPORTCARD-S1 | NON TESTÉ |
| Permissions enseignant | oui | E2E-API-0008, E2E-API-0028 | NON TESTÉ |
| Permissions établissement | oui | E2E-API-0008, E2E-WEB-REPORTCARD-S1 | NON TESTÉ |

**Parcours identifiés :** 7 · **couverts :** 7 · **sans E2E :** 0 (présence scripts — pas encore PASS)

## 9. Finance

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Frais | oui | E2E-API-0001, E2E-API-0009 | NON TESTÉ |
| Obligations | partiel | 0001 / 0009 | NON TESTÉ |
| Dette ouverte | oui | E2E-API-0011 | NON TESTÉ |
| Paiement | oui | E2E-API-0001, E2E-API-0014 | NON TESTÉ |
| Paiement partiel | partiel | 0001 / 0011 | NON TESTÉ |
| Paiement complet | oui | E2E-API-0001 | NON TESTÉ |
| Reste à payer | partiel | 0011 | NON TESTÉ |
| Historique | partiel | 0001 reçu | NON TESTÉ |
| Rapprochement élève | oui | E2E-API-0001 | NON TESTÉ |
| Isolation tenant | **non** dédié E2E finance | unit `verify:finance-*` | NOT-COVERED en E2E numéroté |
| Cohérence UUID / identifiants publics | **non** E2E | — | NOT-COVERED |
| Cohérence Web/Mobile | **non** E2E live | parité L2 unit | NOT-COVERED |

**Parcours identifiés :** 12 · **couverts :** 9 · **sans E2E :** 3

## 10. Communication

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Annonces | oui API | E2E-API-0012, E2E-API-0014, E2E-API-COM-C3 | NON TESTÉ |
| Destinataires | oui API | E2E-API-COM-C2/C3 | NON TESTÉ |
| Consultation | oui API | C2/C3, 0012 | NON TESTÉ |
| Notifications internes | partiel | E2E-API-COM-C4 ; C1 E2E6 NOT_IMPLEMENTED | NON TESTÉ / SKIPPED-EXISTING E2E6 |
| Web Push | **non** | — | NOT-COVERED |
| Mobile Push | **non** (gate `verify:mobile-push-n1` hors journey) | — | NOT-COVERED |
| Permissions | oui API | COM-C* | NON TESTÉ |
| UI Web create→refresh→read | **non** (audit comm existant) | — | NOT-COVERED |

**Parcours identifiés :** 8 · **couverts :** 4 · **sans E2E :** 4

## 11. Parents

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Connexion | oui | E2E-API-0012, E2E-MOB-0017 | NON TESTÉ |
| Enfants liés | oui | E2E-API-0012 | NON TESTÉ |
| Profil | **non** | — | NOT-COVERED |
| Notes | oui | E2E-API-0012 | NON TESTÉ |
| Présences | oui | E2E-API-0012 | NON TESTÉ |
| Paiements | oui | E2E-API-0001, E2E-API-0012 | NON TESTÉ |
| Obligations | partiel | 0012 | NON TESTÉ |
| Communication | partiel | 0012 annonces | NON TESTÉ |
| Isolation parent A ≠ enfant B | oui | E2E-API-0012 | NON TESTÉ |

**Parcours identifiés :** 9 · **couverts :** 8 · **sans E2E :** 1

## 12. Aide

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Accès Aide | **non** (viewport smoke `verify:help-v1b-viewport` hors E2E métier) | — | NOT-COVERED |
| Parcours utilisateur | **non** | — | NOT-COVERED |
| Raccourci | **non** | — | NOT-COVERED |

**Parcours identifiés :** 3 · **couverts :** 0 · **sans E2E :** 3 · **taux :** 0 %

## 13. Administration plateforme

| Parcours métier | E2E trouvé | ID | Statut |
| --------------- | ---------- | -- | ------ |
| Écoles | oui | E2E-API-ONBOARD, E2E-BE-ESTABLISHMENT | NON TESTÉ |
| Utilisateurs | oui | E2E-API-0003, E2E-API-ADMIN-USER | NON TESTÉ |
| Restrictions Superadmin | partiel | report-card S1, COM, `verify:platform-personal-data-deny` (non E2E journey) | NON TESTÉ |
| Séparation plateforme / établissement | partiel | ONBOARD, ADMIN-USER, 0015 | NON TESTÉ |

**Parcours identifiés :** 4 · **couverts :** 4

## 14. Domaines supplémentaires présents dans le produit

| Domaine | E2E métier ? | Commentaire |
| ------- | ------------ | ----------- |
| Planning hebdomadaire / salles / remplacements | partiel | E2E-WEB-PLANNING + E2E-API-0028 ; salles/remplacements = gates `verify:planning-*` non journey utilisateur complet |
| Abonnements / trial | partiel | E2E-API-0015 ; trial request = tests red unitaires LandingPage |
| Sync mobile L1 / offline natif | partiel | E2E-API-SYNC + E2E-MOB-0022 (Expo web) ; pas de device sync |
| Demo / vitrine | non E2E métier | `verify:demo-*` |
| Export / privacy / erasure | non E2E | `verify:data-export-safety`, `verify:privacy-erasure` |
| Help catalog | non E2E | `verify:help-*` |
| Guided school setup | non E2E | `verify:school-setup-guided-*` unit |
| Push N1 | non E2E journey | `verify:mobile-push-n1` |

## 15. Parité Web / Mobile (contrat métier identique)

| Domaine | Couvert Web+Mobile E2E | Web seulement | Mobile seulement | Aucun E2E | Divergence documentée (non corrigée) |
| ------- | ---------------------- | ------------- | ---------------- | --------- | ------------------------------------ |
| Login rôles | API + Mobile web 0017 | — | Maestro login natif NOT-RUNNABLE | — | natif non exécuté ici |
| Classes / fiche élève | API 0004/0005 + Mobile 0020/0023 | — | Maestro 04 BLOCKED | — | — |
| Présences mutation | API 0013 | — | Maestro 12 DISABLED | UI Web Playwright absente | mutation mobile volontairement bloquée |
| Notes saisie | API 0008/0013 | — | Maestro 08 smoke BLOCKED | UI Web Playwright absente | audits Notes V2 vs 0008 |
| Finance paiement | API 0001/0009/0011 | — | Maestro 05 smoke BLOCKED | UI Web Playwright absente | — |
| Communication | API COM + 0012/0014 | pas de Playwright Web UI | pas de Maestro comm | Web Push / Mobile Push | audit comm : pas de create→refresh UI |
| Bulletins | Playwright Web S1 | Mobile LOT 8 unit seulement | — | — | Mobile hors S1 E2E |
| Setup wizard | — | unit Web | unit Mobile | **aucun E2E** | — |
| Aide | — | viewport smoke | smoke mobile | **aucun E2E** | — |
| Planning | Playwright Web | API 0028 | — | Mobile planning E2E absent | — |

## 16. Compteurs de présence (avant exécution)

```text
Tests / suites E2E découverts (IDs inventaire hors ABSENT 0007/0016) : 58
  dont agrégateurs : 4
  dont chaînes verify:e2e-* : 27
  dont autres verify-*-e2e / multi-composants : 12
  dont flux Maestro : 12
Tests exécutables théoriques sur ENV-LOCAL : 43 (hors Maestro + hors agrégateurs dupliqués si on exécute les enfants)
Tests NOT-RUNNABLE ici (Maestro runtime) : 10 exécutables + 2 disabled
Tests déjà DISABLED / SKIPPED-EXISTING : E2E-MAE-09, E2E-MAE-11, E2E-MAE-12, COM-C1 E2E6
Tests jamais exécutés par la CI : 27 chaînes verify:e2e-* + agrégateurs
```

Les totaux d’**exécution** (PASS/FAIL/…) sont dans `execution-report.md`.
