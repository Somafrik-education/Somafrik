# Matrice de couverture métier vs E2E

**SHA audité :** `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8`  
**Règle :** l’absence d’un test n’est jamais une réussite.  
**Alignement :** cette matrice reprend les statuts de `execution-report.md`. Plus aucune ligne exécutée ne reste en `NON TESTÉ`.

Légende des statuts d’exécution :

| Statut | Sens |
| ------ | ---- |
| PASS | Scénario exécuté, assertions officielles OK (peut être isolé / in-memory). |
| FAIL-DATA | Script lancé ; arrêté par jeu de données / seed / login 401. Le métier sous-jacent n’est **pas** prouvé. |
| FAIL-PRODUCT | Anomalie produit observée (hors cette matrice parcours, voir `failures.md`). |
| BLOCKED | Impossible à lancer (Maestro device/APK). |
| SKIPPED-EXISTING | Déjà désactivé avant l’audit. |
| NOT-COVERED | Aucun E2E trouvé. |
| Mixte | Plusieurs IDs : chaque ID a son statut ; le parcours n’est PASS que si **tous** les IDs live requis sont PASS. |

Un PASS isolé (PG spawn / in-memory) **n’annule pas** un FAIL-DATA sur la chaîne HTTP partagée du même parcours.

## 1. Authentification / sécurité

| Parcours métier | E2E trouvé | Surface | ID | Couverture Web/Mobile | Statut exécution |
| --------------- | ---------- | ------- | -- | --------------------- | ---------------- |
| Connexion Superadmin | oui | API | E2E-API-ONBOARD | API seulement | FAIL-DATA (401) |
| Connexion Administrateur établissement | oui | API + Mobile web + Maestro | E2E-API-ONBOARD, E2E-API-0014, E2E-MOB-0017, E2E-MAE-01 | Web API + Mobile web ; natif BLOCKED | FAIL-DATA (ONBOARD/0014/0017) ; MAE-01 BLOCKED |
| Connexion Enseignant | oui | API + Mobile web + in-memory | E2E-API-0006, E2E-API-0013, E2E-MOB-0017 | 0006 in-memory PASS ; HTTP/UI FAIL-DATA | PASS (0006 in-memory) ; FAIL-DATA (0013, 0017) |
| Connexion Parent/Élève | oui | API + Mobile web | E2E-API-0012, E2E-MOB-0017 | Parent API + Mobile web | FAIL-DATA |
| Mauvais identifiants | partiel | Mobile web | E2E-MOB-0018 | Mobile web seulement (PIN) | FAIL-DATA (préparation 401) |
| Mauvais code établissement | partiel | Mobile web | E2E-MOB-0018 | Mobile web seulement | FAIL-DATA (préparation 401) |
| Séparation tenant | partiel | API / Web bulletins / COM | E2E-API-0012, E2E-WEB-REPORTCARD-S1, E2E-API-COM-C* | pas de journey Superadmin UI cross-school | PASS (S1 + COM isolés) ; FAIL-DATA (0012) |
| Session expirée | **non** | — | — | aucun E2E | NOT-COVERED |
| Logout | **non** | — | — | aucun E2E | NOT-COVERED |
| Droits RBAC | partiel | API / planning / bulletins / COM | E2E-API-0013, E2E-API-0028, E2E-WEB-PLANNING, E2E-WEB-REPORTCARD-S1 | pas de matrice UI Superadmin | PASS (planning web + S1) ; FAIL-DATA (0013, 0028) |
| Accès interdit entre établissements | partiel | bulletins S1 + COM | E2E-WEB-REPORTCARD-S1, E2E-API-COM-C* | Web Playwright bulletins | PASS (S1 + COM isolés) |
| Changement de mot de passe obligatoire | partiel (helper login) | API helper | `e2e-api-helpers.js` | pas de scénario autonome | NOT-COVERED |

**Parcours métier identifiés :** 12  
**Parcours couverts par E2E (script présent) :** 9  
**Parcours sans E2E :** 3  
**PASS vérifié sur le parcours live complet :** 1 (cross-tenant S1+COM). Les logins HTTP partagés = **FAIL-DATA**, pas PASS.

## 2. Configuration établissement

| Parcours métier | E2E trouvé | Surface | ID | Statut exécution |
| --------------- | ---------- | ------- | -- | ---------------- |
| Création / configuration initiale | oui | API + in-memory | E2E-API-ONBOARD, E2E-BE-ESTABLISHMENT | PASS (establishment in-memory) ; FAIL-DATA (ONBOARD HTTP) |
| Informations établissement | partiel | in-memory | E2E-BE-ESTABLISHMENT | PASS (in-memory) |
| Année scolaire | partiel | helper `setupActiveSchool` | E2E-API-* | FAIL-DATA (helper jamais atteint : 401) |
| Référentiels | **non** | — | — | NOT-COVERED |
| Setup wizard guidé | **non** | — | — | NOT-COVERED |

**Parcours identifiés :** 5 · **scripts présents :** 3 · **sans E2E :** 2 · **PASS live HTTP :** 0

## 3. Classes

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Création | oui | E2E-API-0004, E2E-API-0014 | FAIL-DATA |
| Modification | partiel | E2E-API-0004 | FAIL-DATA |
| Consultation / liste | oui | E2E-API-0004, E2E-MOB-0020, E2E-MAE-04 | FAIL-DATA (0004, 0020) ; MAE-04 BLOCKED |
| Classe active/inactive | oui | E2E-API-0004 | FAIL-DATA |
| Professeur principal | **non** | — | NOT-COVERED |
| Affectation élèves | oui | E2E-API-0005 | FAIL-DATA |
| Isolation établissement | partiel | COM / sync / 0005 | PASS (COM + sync isolés) ; FAIL-DATA (0005) |

**Parcours identifiés :** 7 · **scripts présents :** 5 · **sans E2E :** 2

## 4. Élèves

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Création flux canonique | oui | E2E-API-0005 | FAIL-DATA |
| Consultation / fiche | oui | E2E-API-0005, E2E-MOB-0020/0023 | FAIL-DATA |
| Modification autorisée | partiel | E2E-API-0005 | FAIL-DATA |
| Archivage / suppression | **non** | — | NOT-COVERED |
| Rattachement classe | oui | E2E-API-0005 | FAIL-DATA |
| Matricule | partiel | E2E-API-0005 | FAIL-DATA |
| Parent / responsable | oui | E2E-API-0005, E2E-API-0012 | FAIL-DATA |
| Visibilité Web/Mobile | partiel | 0005 / 0020 / 0023 | FAIL-DATA ; Maestro natif BLOCKED |

**Parcours identifiés :** 8 · **scripts présents :** 7 · **sans E2E :** 1

## 5. Enseignants

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Création | oui (contacts-first) | E2E-API-0006 | PASS (in-memory uniquement) |
| Consultation | partiel | E2E-MAE-06, E2E-API-0014 | FAIL-DATA (0014) ; MAE-06 BLOCKED |
| Affectations | oui | E2E-API-0006, E2E-API-0028 | PASS (0006 in-memory) ; FAIL-DATA (0028 HTTP) |
| Matières / cours | partiel | E2E-API-0028 | FAIL-DATA |
| Professeur principal | **non** | — | NOT-COVERED |
| Isolation tenant | partiel | 0006 scope enseignant | PASS (0006 in-memory) |

**Parcours identifiés :** 6 · **scripts présents :** 5 · **sans E2E :** 1

## 6. Matières / cours

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Création | partiel | E2E-API-0028 / E2E-WEB-PLANNING | PASS (planning web isolé) ; FAIL-DATA (0028) |
| Unicité scope établissement | **non** | — | NOT-COVERED |
| Affectation classes | partiel | E2E-API-0006 / 0028 | PASS (0006 in-memory) ; FAIL-DATA (0028) |
| Affectation enseignants | oui | E2E-API-0006 | PASS (in-memory) |
| Lecture | partiel | E2E-WEB-PLANNING | PASS |
| Suppression / désactivation | **non** | — | NOT-COVERED |

**Parcours identifiés :** 6 · **scripts présents :** 4 · **sans E2E :** 2

## 7. Présences

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Appel | oui API | E2E-API-0013, E2E-API-0014 | FAIL-DATA |
| Présent / Absent / Retard / Justifié | partiel API ; Maestro mutation DISABLED | 0013 / E2E-MAE-12 | FAIL-DATA (0013) ; MAE-12 SKIPPED-EXISTING |
| État par défaut | **non** | — | NOT-COVERED |
| Modification | partiel | 0013 | FAIL-DATA |
| Statistiques | partiel Maestro home | E2E-MAE-02 | BLOCKED |
| Parité Web/Mobile | **non** en E2E live | parité unit seulement | NOT-COVERED |

**Parcours identifiés :** 6 · **scripts présents :** 3 · **sans E2E :** 3

## 8. Notes / pédagogie

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Création évaluation | oui | E2E-API-0008, E2E-API-0013 | FAIL-DATA |
| Saisie notes | oui | E2E-API-0008 | FAIL-DATA |
| Consultation | oui | E2E-API-0008, E2E-API-0012, E2E-MOB-0023 | FAIL-DATA |
| Moyennes | oui | E2E-API-0008 | FAIL-DATA |
| Bulletin / résultat | oui Playwright S1 | E2E-WEB-REPORTCARD-S1 | PASS |
| Permissions enseignant | oui | E2E-API-0008, E2E-API-0028 | FAIL-DATA |
| Permissions établissement | oui | E2E-API-0008, E2E-WEB-REPORTCARD-S1 | PASS (S1) ; FAIL-DATA (0008) |

**Parcours identifiés :** 7 · **scripts présents :** 7 · **sans E2E :** 0 · **PASS live bulletin :** oui (S1 isolé) · **PASS saisie notes HTTP partagée :** non (FAIL-DATA)

## 9. Finance

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Frais | oui | E2E-API-0001, E2E-API-0009 | FAIL-DATA |
| Obligations | partiel | 0001 / 0009 | FAIL-DATA |
| Dette ouverte | oui | E2E-API-0011 | FAIL-DATA |
| Paiement | oui | E2E-API-0001, E2E-API-0014 | FAIL-DATA |
| Paiement partiel | partiel | 0001 / 0011 | FAIL-DATA |
| Paiement complet | oui | E2E-API-0001 | FAIL-DATA |
| Reste à payer | partiel | 0011 | FAIL-DATA |
| Historique | partiel | 0001 reçu | FAIL-DATA |
| Rapprochement élève | oui | E2E-API-0001 | FAIL-DATA |
| Isolation tenant | **non** dédié E2E finance | unit `verify:finance-*` | NOT-COVERED en E2E numéroté |
| Cohérence UUID / identifiants publics | **non** E2E | — | NOT-COVERED |
| Cohérence Web/Mobile | **non** E2E live | parité L2 unit | NOT-COVERED |

**Parcours identifiés :** 12 · **scripts présents :** 9 · **sans E2E :** 3 · **PASS HTTP partagé :** 0  
Note : `verify:sync-end-to-end` inclut un domaine Finance en **PASS isolé** (fixtures propres), distinct des chaînes 0001/0009/0011.

## 10. Communication

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Annonces | oui API | E2E-API-0012, E2E-API-0014, E2E-API-COM-C3 | PASS (C3 isolé) ; FAIL-DATA (0012, 0014) |
| Destinataires | oui API | E2E-API-COM-C2/C3 | PASS |
| Consultation | oui API | C2/C3, 0012 | PASS (C2/C3) ; FAIL-DATA (0012) |
| Notifications internes | partiel | E2E-API-COM-C4 ; C1 E2E6 | PASS (C4) ; E2E6 SKIPPED-EXISTING |
| Web Push | **non** | — | NOT-COVERED |
| Mobile Push | **non** | — | NOT-COVERED |
| Permissions | oui API | COM-C* | PASS |
| UI Web create→refresh→read | **non** | — | NOT-COVERED |

**Parcours identifiés :** 8 · **scripts présents :** 4 · **sans E2E :** 4

## 11. Parents

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Connexion | oui | E2E-API-0012, E2E-MOB-0017 | FAIL-DATA |
| Enfants liés | oui | E2E-API-0012 | FAIL-DATA |
| Profil | **non** | — | NOT-COVERED |
| Notes | oui | E2E-API-0012 | FAIL-DATA |
| Présences | oui | E2E-API-0012 | FAIL-DATA |
| Paiements | oui | E2E-API-0001, E2E-API-0012 | FAIL-DATA |
| Obligations | partiel | 0012 | FAIL-DATA |
| Communication | partiel | 0012 annonces | FAIL-DATA |
| Isolation parent A ≠ enfant B | oui | E2E-API-0012 | FAIL-DATA |

**Parcours identifiés :** 9 · **scripts présents :** 8 · **sans E2E :** 1 · **PASS HTTP partagé :** 0

## 12. Aide

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Accès Aide | **non** | — | NOT-COVERED |
| Parcours utilisateur | **non** | — | NOT-COVERED |
| Raccourci | **non** | — | NOT-COVERED |

**Parcours identifiés :** 3 · **couverts :** 0 · **sans E2E :** 3 · **taux :** 0 %

## 13. Administration plateforme

| Parcours métier | E2E trouvé | ID | Statut exécution |
| --------------- | ---------- | -- | ---------------- |
| Écoles | oui | E2E-API-ONBOARD, E2E-BE-ESTABLISHMENT | PASS (in-memory) ; FAIL-DATA (ONBOARD) |
| Utilisateurs | oui | E2E-API-0003, E2E-API-ADMIN-USER | PASS (admin-user isolé) ; FAIL-DATA (0003) |
| Restrictions Superadmin | partiel | report-card S1, COM | PASS (S1 + COM isolés) |
| Séparation plateforme / établissement | partiel | ONBOARD, ADMIN-USER, 0015 | PASS (admin-user isolé) ; FAIL-DATA (ONBOARD, 0015) |

**Parcours identifiés :** 4 · **scripts présents :** 4

## 14. Domaines supplémentaires présents dans le produit

| Domaine | E2E métier ? | Statut exécution |
| ------- | ------------ | ---------------- |
| Planning hebdomadaire | partiel | PASS (E2E-WEB-PLANNING) ; FAIL-DATA (0028) |
| Abonnements / trial | partiel | FAIL-DATA (0015) |
| Sync multi-domaines | oui isolé | PASS (`verify:sync-end-to-end`) |
| Sync mobile L1 / offline natif | partiel | FAIL-DATA (0022) ; pas de device sync |
| Demo / vitrine | non E2E métier | hors périmètre journey |
| Export / privacy | non E2E | NOT-COVERED |
| Help catalog | non E2E | NOT-COVERED |
| Guided school setup | non E2E | NOT-COVERED |
| Push N1 | non E2E journey | NOT-COVERED |

## 15. Parité Web / Mobile (contrat métier identique)

| Domaine | Couvert Web+Mobile E2E | Web seulement | Mobile seulement | Aucun E2E | Exécution ici |
| ------- | ---------------------- | ------------- | ---------------- | --------- | ------------- |
| Login rôles | API + Mobile web 0017 | — | Maestro 01 BLOCKED | — | FAIL-DATA API/mobile ; natif BLOCKED |
| Classes / fiche élève | API 0004/0005 + Mobile 0020/0023 | — | Maestro 04 BLOCKED | — | FAIL-DATA |
| Présences mutation | API 0013 | — | Maestro 12 SKIPPED-EXISTING | UI Web Playwright absente | FAIL-DATA / SKIPPED-EXISTING |
| Notes saisie | API 0008/0013 | — | Maestro 08 BLOCKED | UI Web Playwright absente | FAIL-DATA |
| Finance paiement | API 0001/0009/0011 | — | Maestro 05 BLOCKED | UI Web Playwright absente | FAIL-DATA |
| Communication | API COM + 0012/0014 | pas de Playwright Web UI | pas de Maestro comm | Web/Mobile Push | PASS COM isolé ; FAIL-DATA 0012/0014 |
| Bulletins | Playwright Web S1 | Mobile LOT 8 unit | — | — | PASS Web S1 |
| Setup wizard | — | unit Web | unit Mobile | **aucun E2E** | NOT-COVERED |
| Aide | — | viewport smoke | smoke mobile | **aucun E2E** | NOT-COVERED |
| Planning | Playwright Web | API 0028 | — | Mobile planning E2E absent | PASS Web ; FAIL-DATA 0028 |

## 16. Compteurs

Présence (scripts) : voir inventaire.  
Exécution : **uniquement** `execution-report.md` — ne pas additionner cette matrice avec les totaux de suites (un parcours métier peut regrouper plusieurs IDs).
