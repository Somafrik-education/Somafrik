# E2E-PREPROD-GLOBAL-01 — Matrice E2E globale

**125 scénarios.** 0 PASS, 0 FAIL, **125 BLOCKED**, 0 NOT APPLICABLE.

Aucun scénario n'a pu être exécuté en préproduction ; voir `RAPPORT-FINAL-CTO.md` §2. Un scénario BLOCKED n'est jamais compté comme réussi.

**Rôles :**
- SA : Superadmin ;
- AP : Admin Pays ;
- AS : Admin School ;
- PE : Préfet des études ;
- SE : Secrétaire ;
- EN : Enseignant ;
- CO : Comptable ;
- PA : Parent ;
- EL : Élève.

**Plateformes :** W (Web), M (Mobile), API, PG (vérification PostgreSQL).

**Types :** pos (positif), neg (refus attendu), tenant (isolation), persist (persistance), parity (parité Web/Mobile).

**Codes de blocage :**
- **BLK-AUTH :** aucun compte de test de préproduction (identifiants) n'est disponible dans cette session. Aucun mot de passe ne doit transiter dans la conversation.
- **BLK-PERM :** le classifieur de permissions de l'environnement refuse toute interaction avec la préproduction au-delà d'un contrôle de disponibilité. Il faut une autorisation explicite de l'utilisateur (règle de permission).
- **BLK-MOBILE :** pas d'appareil Android ni d'émulateur exploitable (pas de KVM), et pas d'APK Preview relié à la préproduction dans ce conteneur.
- **BLK-PG :** pas d'accès contrôlé à la base PostgreSQL de préproduction.

« Couverture automatisée » renvoie aux suites de non-régression locales ou CI. Elles **ne remplacent pas** l'E2E réel (mandat §1) et ne changent pas le statut.

| ID | Domaine | Scénario | Rôles | Plateformes | Type | SHA testé | Statut | Blocage | Couverture automatisée (hors E2E) |
|---|---|---|---|---|---|---|---|---|---|
| E2E-001 | A. Authentification et sécurité | Connexion valide puis déconnexion | AS, EN, PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-002 | A. Authentification et sécurité | Mot de passe erroné : refus et compteur de verrouillage | AS | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-003 | A. Authentification et sécurité | Actualisation de session (refresh) et rotation du jeton | AS | W, M, API | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-004 | A. Authentification et sécurité | Session expirée : retour à la connexion sans perte silencieuse | EN | W, M | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-005 | A. Authentification et sécurité | Mot de passe provisoire : changement obligatoire avant tout accès | EN, PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-006 | A. Authentification et sécurité | Réinitialisation du mot de passe par un administrateur | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-007 | A. Authentification et sécurité | Afficher / masquer le mot de passe | Tous | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-008 | A. Authentification et sécurité | Compte suspendu, inactif ou bloqué : connexion refusée | EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-009 | A. Authentification et sécurité | Accès sans authentification aux routes protégées : 401 | Anonyme | API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-010 | A. Authentification et sécurité | Isolation : un utilisateur de l'école A ne lit aucune ressource de l'école B | AS, EN | API, W | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-011 | A. Authentification et sécurité | Ressource non autorisée (ID d'un autre établissement) : 403/404 | EN, CO | API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-012 | A. Authentification et sécurité | Droits recalculés après retrait d'un rôle (révocation effective) | AS, EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-013 | A. Authentification et sécurité | Endpoint E2E clear-login-lockout désactivé en préproduction si SOMAFRIK_E2E≠true | Anonyme | API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend unit (auth, lockout, sessions), RBAC HTTP live |
| E2E-014 | B. Administration plateforme | Superadmin : création d'un établissement et rattachement à un pays | SA | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-015 | B. Administration plateforme | Admin Pays : périmètre limité à son pays | AP | W, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-016 | B. Administration plateforme | Admin School : création, modification, désactivation d'un compte | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | RBAC HTTP live, backend unit RBAC |
| E2E-017 | B. Administration plateforme | Attribution puis révocation d'un rôle | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-018 | B. Administration plateforme | Libellés personnalisés des rôles | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | RBAC HTTP live, backend unit RBAC |
| E2E-019 | B. Administration plateforme | Permissions RBAC : matrice rôle × module (lecture/écriture) | Tous | API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-020 | B. Administration plateforme | Utilisateur multi-rôles : union correcte sans élargissement indu | PE+EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | RBAC HTTP live, backend unit RBAC |
| E2E-021 | B. Administration plateforme | Superadmin : pas d'accès global aux données scolaires | SA | API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-022 | B. Administration plateforme | Accès inter-établissements refusé pour Admin School | AS | API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | RBAC HTTP live, backend unit RBAC |
| E2E-023 | C. Configuration établissements | Informations administratives, pays, devise, identité | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-024 | C. Configuration établissements | Logo : envoi, remplacement, suppression | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-025 | C. Configuration établissements | Années scolaires : création, année courante | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-026 | C. Configuration établissements | Périodes (trimestres/semestres) | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-027 | C. Configuration établissements | Niveaux, sections, classes et groupes | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-028 | C. Configuration établissements | Matières et coefficients | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-029 | C. Configuration établissements | Types d'évaluation : création et archivage | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-030 | C. Configuration établissements | Paramètres généraux : refus d'écriture sans Paramètres Établissement:UPDATE | PE, SE | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-031 | C. Configuration établissements | Persistance après rechargement de chaque écran de configuration | AS | W, M | persist | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | guided-green, PG audit10, LOT 0–4 |
| E2E-032 | D. Utilisateurs et enseignants | Création d'un enseignant | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (teacher assignments) |
| E2E-033 | D. Utilisateurs et enseignants | Attribution de plusieurs matières | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (teacher assignments) |
| E2E-034 | D. Utilisateurs et enseignants | Affectation aux classes | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (teacher assignments) |
| E2E-035 | D. Utilisateurs et enseignants | Professeur principal : désignation et remplacement | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (teacher assignments) |
| E2E-036 | D. Utilisateurs et enseignants | Modification d'identité | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (teacher assignments) |
| E2E-037 | D. Utilisateurs et enseignants | Suspension puis réactivation | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (teacher assignments) |
| E2E-038 | D. Utilisateurs et enseignants | Archivage d'une classe ou d'une matière : affectations cohérentes | AS | W, API | persist | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (teacher assignments) |
| E2E-039 | D. Utilisateurs et enseignants | Enseignant : aucun accès aux autres classes ni écoles | EN | W, M, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (teacher assignments) |
| E2E-040 | E. Élèves et inscriptions | Inscription d'un élève exclusivement depuis une classe | AS, SE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (enrollment C18), LOT 0–2 |
| E2E-041 | E. Élèves et inscriptions | Génération et unicité du matricule | SE | W, API | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (enrollment C18), LOT 0–2 |
| E2E-042 | E. Élèves et inscriptions | Modification des informations autorisées | SE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (enrollment C18), LOT 0–2 |
| E2E-043 | E. Élèves et inscriptions | Recherche et filtres | SE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (enrollment C18), LOT 0–2 |
| E2E-044 | E. Élèves et inscriptions | Changement de classe (date d'effet, obligations) | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (enrollment C18), LOT 0–2 |
| E2E-045 | E. Élèves et inscriptions | Statut d'inscription et archivage | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (enrollment C18), LOT 0–2 |
| E2E-046 | E. Élèves et inscriptions | Cohérence des effectifs (classe, tableau de bord) | AS | W, M | persist | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG (enrollment C18), LOT 0–2 |
| E2E-047 | E. Élèves et inscriptions | Association aux parents | SE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (enrollment C18), LOT 0–2 |
| E2E-048 | E. Élèves et inscriptions | Réinscription / changement d'année si disponible | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG (enrollment C18), LOT 0–2 |
| E2E-049 | F. Présences | Liste exacte des inscrits de la classe | EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-050 | F. Présences | Statut par défaut et passage Absent / Retard / Justifié | EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-051 | F. Présences | Enregistrement, modification, absence de doublon | EN | W, M, API | persist | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-052 | F. Présences | Historique et compteurs | PE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-053 | F. Présences | Enseignant limité à ses classes | EN | W, M, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-054 | F. Présences | Parité Web / Mobile des données de présence | EN | W, M | parity | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 5 parity, backend PG presences |
| E2E-055 | G. Cours et emploi du temps | Création et modification d'un cours | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG planning |
| E2E-056 | G. Cours et emploi du temps | Affectation classe / matière / enseignant | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG planning |
| E2E-057 | G. Cours et emploi du temps | Consultation de l'emploi du temps par enseignant | EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG planning |
| E2E-058 | G. Cours et emploi du temps | Détection des conflits horaires | AS | W | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG planning |
| E2E-059 | G. Cours et emploi du temps | Remplacements : création et notification | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG planning |
| E2E-060 | G. Cours et emploi du temps | Annulation et reprogrammation | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG planning |
| E2E-061 | G. Cours et emploi du temps | Accès aux seuls cours autorisés | EN | W, M, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG planning |
| E2E-062 | H. Notes et évaluations | Création d'une évaluation | EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 3 parity, backend PG pedagogy |
| E2E-063 | H. Notes et évaluations | Saisie et modification des notes | EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 3 parity, backend PG pedagogy |
| E2E-064 | H. Notes et évaluations | Pondérations et coefficients | PE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 3 parity, backend PG pedagogy |
| E2E-065 | H. Notes et évaluations | Valeurs limites (négatif, > barème, décimales) | EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 3 parity, backend PG pedagogy |
| E2E-066 | H. Notes et évaluations | Calcul des moyennes vérifié indépendamment | PE | W, API, PG | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-PG | LOT 3 parity, backend PG pedagogy |
| E2E-067 | H. Notes et évaluations | Notes manquantes et absences | EN | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 3 parity, backend PG pedagogy |
| E2E-068 | H. Notes et évaluations | Résultats par classe et période | PE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 3 parity, backend PG pedagogy |
| E2E-069 | H. Notes et évaluations | Enseignant limité à ses classes et matières | EN | W, M, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 3 parity, backend PG pedagogy |
| E2E-070 | I. Bulletins | Génération d'un bulletin par élève | PE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 8 parity, report-card PG |
| E2E-071 | I. Bulletins | Génération par classe | PE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 8 parity, report-card PG |
| E2E-072 | I. Bulletins | Modèles Burundi et RDC | PE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 8 parity, report-card PG |
| E2E-073 | I. Bulletins | Coefficients, totaux, moyennes cohérents avec les notes sources | PE | W, PG | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-PG | LOT 8 parity, report-card PG |
| E2E-074 | I. Bulletins | Appréciations et classements | PE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | LOT 8 parity, report-card PG |
| E2E-075 | I. Bulletins | Téléchargement / impression PDF | PE, PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 8 parity, report-card PG |
| E2E-076 | I. Bulletins | Accès et téléchargement restreints | PA, EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | LOT 8 parity, report-card PG |
| E2E-077 | J. Finances | Grilles tarifaires | CO, AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG finance, finance convergence |
| E2E-078 | J. Finances | Obligations financières générées | CO | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG finance, finance convergence |
| E2E-079 | J. Finances | Paiement partiel puis complet | CO | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG finance, finance convergence |
| E2E-080 | J. Finances | Imputation des paiements sur les obligations | CO | W, API, PG | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-PG | backend PG finance, finance convergence |
| E2E-081 | J. Finances | Soldes et impayés | CO | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG finance, finance convergence |
| E2E-082 | J. Finances | Recherche par matricule et filtres par période | CO | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | backend PG finance, finance convergence |
| E2E-083 | J. Finances | Historique des encaissements | CO | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG finance, finance convergence |
| E2E-084 | J. Finances | Idempotence : aucun paiement enregistré deux fois (rejeu) | CO | W, M, API, PG | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE, BLK-PG | backend PG finance, finance convergence |
| E2E-085 | J. Finances | Relances | CO | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG finance, finance convergence |
| E2E-086 | J. Finances | Rapports financiers | AS, CO | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG finance, finance convergence |
| E2E-087 | J. Finances | Permissions comptable / administrateur / enseignant | CO, EN | W, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | backend PG finance, finance convergence |
| E2E-088 | K. Communication | Message direct | AS, EN, PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-089 | K. Communication | Annonce ciblée (classe, rôle) | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-090 | K. Communication | Notification manuelle | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | communications C1–C4, LOT 6–7 |
| E2E-091 | K. Communication | Paramétrage des notifications (Web, et Mobile #1175) | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-092 | K. Communication | Destinataires et permissions | AS, EN | W, M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-093 | K. Communication | Consultation et lecture | PA, EN | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-094 | K. Communication | Notifications push | PA | M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | communications C1–C4, LOT 6–7 |
| E2E-095 | K. Communication | Aucune fuite de messages entre établissements | AS | API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | communications C1–C4, LOT 6–7 |
| E2E-096 | L. Parents et élèves | Création du compte parent | SE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | parent-linking PG, mobile parent tests |
| E2E-097 | L. Parents et élèves | Connexion parent par mot de passe | PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | parent-linking PG, mobile parent tests |
| E2E-098 | L. Parents et élèves | Plusieurs enfants liés | PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | parent-linking PG, mobile parent tests |
| E2E-099 | L. Parents et élèves | Consultation notes, présences, finances des enfants | PA | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | parent-linking PG, mobile parent tests |
| E2E-100 | L. Parents et élèves | Limitation aux seuls enfants liés | PA | W, M, API | tenant | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | parent-linking PG, mobile parent tests |
| E2E-101 | L. Parents et élèves | Modification / suppression d'un lien parent-élève | SE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | parent-linking PG, mobile parent tests |
| E2E-102 | L. Parents et élèves | Compte élève (si pris en charge) | EL | M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | parent-linking PG, mobile parent tests |
| E2E-103 | M. Tableaux de bord | Indicateurs d'effectifs cohérents avec les données sources | AS | W, M, PG | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE, BLK-PG | dashboard KPI tests |
| E2E-104 | M. Tableaux de bord | Indicateurs de présences | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | dashboard KPI tests |
| E2E-105 | M. Tableaux de bord | Indicateurs financiers | AS, CO | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | dashboard KPI tests |
| E2E-106 | M. Tableaux de bord | Activités récentes | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | dashboard KPI tests |
| E2E-107 | M. Tableaux de bord | Graphiques, filtres, sélecteurs de période, actualisation | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | dashboard KPI tests |
| E2E-108 | M. Tableaux de bord | États vides, erreurs et chargements | AS | W, M | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | dashboard KPI tests |
| E2E-109 | N. Cartes, QR, NFC | Activation Carte élève et paramètres du titulaire | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-110 | N. Cartes, QR, NFC | Configuration QR | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-111 | N. Cartes, QR, NFC | Contrôle de présence par QR | EN | M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-112 | N. Cartes, QR, NFC | Contrôle financier informatif | SE | M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-113 | N. Cartes, QR, NFC | Génération et vérification des cartes (périmètre homologué) | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-114 | N. Cartes, QR, NFC | Appel hors connexion Mobile et synchronisation sans doublon | EN | M | persist | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-115 | N. Cartes, QR, NFC | Rejet des accès non autorisés | PA | M, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-116 | N. Cartes, QR, NFC | NFC non homologué : refus 409 STUDENT_CARD_NFC_NOT_HOMOLOGATED (verrou maintenu) | AS | W, API | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM (test négatif sûr, mais authentifié) ; verrou NFC jamais contourné | NFC PG 16, rollcall-offline, Hermes CI |
| E2E-117 | O. Transversal | Recherche, filtres, pagination | AS | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | date contract, French copy, architecture audit |
| E2E-118 | O. Transversal | Import / export disponibles | AS | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | date contract, French copy, architecture audit |
| E2E-119 | O. Transversal | Envoi et téléchargement de documents | SE | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | date contract, French copy, architecture audit |
| E2E-120 | O. Transversal | Impression | SE | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | date contract, French copy, architecture audit |
| E2E-121 | O. Transversal | Préférences utilisateur | Tous | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | date contract, French copy, architecture audit |
| E2E-122 | O. Transversal | Accessibilité élémentaire et navigation clavier | Tous | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | date contract, French copy, architecture audit |
| E2E-123 | O. Transversal | Navigateurs pris en charge | Tous | W | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM | date contract, French copy, architecture audit |
| E2E-124 | O. Transversal | États chargement / erreur / vide / hors connexion | Tous | W, M | neg | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | date contract, French copy, architecture audit |
| E2E-125 | O. Transversal | Formats français des dates (JJ-MM-AAAA) et des montants | Tous | W, M | pos | `763d9bd8` (dépôt) — préprod : SHA non relevé | **BLOCKED** | BLK-AUTH, BLK-PERM, BLK-MOBILE | date contract, French copy, architecture audit |
