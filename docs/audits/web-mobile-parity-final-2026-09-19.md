# Ré-audit global final Web ↔ Mobile — Somafrik

Date : 2026-09-19  
Baseline historique : PR #704 — `ea50361d2a97cbb02e20c7b4496a5b0bdfa2287d`  
État final audité : `develop@0d5a3ae4fb65ec44c3e608be6abfaa5b402b0a35`  
Branche de rapport : `cursor/final-web-mobile-parity-reaudit`

> #704 reste une référence historique et ne doit jamais être fusionnée.

## 1. Verdict exécutif

Le chantier de parité Web ↔ Mobile lancé à partir de #704 est **CLOSED GLOBAL**.

La matrice historique de #704 contient **59 IDs PARITY** et **20 IDs ALIGN** distincts. Le re-audit final du code live sur `develop@0d5a3ae4...` conclut :

- **35 IDs PARITY planifiés LOT 0–8 : fermés** ;
- **8 anciens IDs PARITY hors lots : désormais alignés**, dont PARITY-082 corrigé par #718 ;
- **16 anciens IDs PARITY : asymétries intentionnelles documentées** de canal, UX ou administration ;
- **0 ID PARITY fonctionnel réellement ouvert** ;
- les **20 IDs ALIGN** de la baseline ne présentent pas de régression identifiée au re-audit final.

Aucun écart résiduel ne justifie la réouverture d'un LOT 0–8.

## 2. Historique LOT 0–8

| Lot | PR | IDs | HEAD fusionné | Merge commit |
| --- | --- | --- | --- | --- |
| LOT 0 | #705 | 001, 001b, 011, 012, 022 | `c9bd8c0e6e66e8369c38aead9f4168e145c54325` | `e3c874b989a2822c1ef8457c0c012a898cb747f7` |
| LOT 1 | #706 | 018, 019, 029, 037 | `8276cd45a978991bfb736a1f1585aaf6b50cb238` | `38ea23217810f12587ba29241baedfa8a64ce9fd` |
| LOT 2 | #707 | 013, 014, 031, 032 | `01e49d0e716cb981992318b1db2991d8752a14b2` | `1d9341da1bd2fc8a0a3bb392acbdf63eb6055c98` |
| LOT 3 | #709 | 028 | `63bd6cd11c8a8ef62b806e802fd78e9dcb3d5a1a` | `907b80d1996113d935ac8c297ba983a18fd1f9b4` |
| LOT 4 | #710 | 015, 016, 080 | `537616fb54bfe8a62919978267bcfe0cae07b85e` | `68077f5259797b07e1da0230c60b95fee7cd1afe` |
| LOT 5 | #711 | 023, 024, 033, 060 | `d141ee615af43703e3821e23800103a1ca145c3b` | `58bdf8913df999cdee773af008d0c253cfb064b1` |
| LOT 6 | #712 | 034, 026, 055, 068 | `8a207065cda9e87b9c6bfdd2bc00722bdfaa014e` | `2a0b4f95b32d1aff40f963a43dae9a59bf8fec31` |
| LOT 7 | #713 | 021, 052, 057, 081, 083 | `d3f6b4a15e540c98726c7393fa3d228347c51c2d` | `3cc55190736abd5d79d4128b35df7c74f38512e8` |
| LOT 8 | #714 | 035, 056, 061, 027, 071 | `e22295e9d1cba2bcc69806fd36f19b02e5a8d94f` | `6bc1ceaf6eb597ca39317452bbf076285c5b8e03` |

## 3. IDs planifiés LOT 0–8

### LOT 0 — sécurité / intégrité
- PARITY-001 : fermé.
- PARITY-001b : fermé.
- PARITY-011 : fermé.
- PARITY-012 : fermé.
- PARITY-022 : fermé.

### LOT 1 — référentiels / établissement
- PARITY-018 : fermé par politique Mobile sans BackOffice plateforme.
- PARITY-019 : fermé par surfaces Settings Mobile canoniques.
- PARITY-029 : fermé par workflow setup post-login.
- PARITY-037 : fermé sur source pédagogique canonique.

### LOT 2 — scolarité
- PARITY-013 : fermé.
- PARITY-014 : fermé.
- PARITY-031 : fermé classe-first.
- PARITY-032 : fermé selon le contrat canonique retenu.

### LOT 3 — enseignants
- PARITY-028 : fermé ; identité enseignant via Users, sans réactivation du POST /teachers legacy.

### LOT 4 — finance
- PARITY-015 : fermé.
- PARITY-016 : fermé.
- PARITY-080 : fermé sur le format visible JJ-MM-AAAA pour les surfaces couvertes.

### LOT 5 — pédagogie
- PARITY-023 : fermé.
- PARITY-024 : fermé ; Mobile dispose d'un écran Examens canonique.
- PARITY-033 : fermé sur calcul canonique.
- PARITY-060 : fermé.

### LOT 6 — communication
- PARITY-034 : fermé.
- PARITY-026 : fermé.
- PARITY-055 : fermé ; les préférences Mobile restent live dans `RoleNavigationDrawer` via `CommunicationPreferencesSheet`.
- PARITY-068 : fermé ; l'ancien écran plateforme orphelin a ensuite été supprimé en LOT 8.

### LOT 7
- PARITY-021 : fermé par suppression de la surface Permissions Mobile orpheline ; RBAC admin = Web/backend canonique.
- PARITY-052 : fermé par équivalence classe-first.
- PARITY-057 : fermé par roster exact fail-closed.
- PARITY-081 : fermé sur hint JJ-MM-AAAA.
- PARITY-083 : fermé sur libellé `Tout présent`.

### LOT 8 — legacy
- PARITY-035 : fermé par décision documentée : GET compat encore live Web ; PUT legacy interdit ; administration via `rbacApi`.
- PARITY-056 : fermé par décision documentée : `EntityPage payments` reste une surface Web canonique ; Mobile Finance canonique.
- PARITY-061 : fermé par suppression physique des écrans morts.
- PARITY-027 : fermé ; suppression des catalogues statiques divergents ; backend PG reste autorité.
- PARITY-071 : fermé ; `GradeBookService` Mobile mort supprimé.

## 4. Anciens IDs hors lots désormais alignés

| ID | Statut final | Preuve actuelle |
| --- | --- | --- |
| PARITY-017 | ALIGNÉ | `TimetableScreen` Mobile gère création, modification, suppression, salles, remplacements et conflits via APIs planning canoniques. |
| PARITY-030 | ALIGNÉ | Web `AuthContext` efface la session sur 401/403 et couvre refresh/logout ; Mobile garde le clear sécurisé. |
| PARITY-051 | ALIGNÉ COMPORTEMENT | Le backend Mobile retourne 423 avec message utilisateur explicite ; le mapping login conserve un message non technique. |
| PARITY-053 | ALIGNÉ | Salles, remplacements et conflits sont traités par `TimetableScreen` + `planningV2`. |
| PARITY-058 | ALIGNÉ | Web et Mobile reposent sur l'historique `/presences` et les projections de présence élève. |
| PARITY-063 | ALIGNÉ UX | Mobile dispose d'une route et d'un `FeeGridsScreen` dédié ; la différence « embarqué paiements » de #704 n'est plus vraie. |
| PARITY-066 | ALIGNÉ | `HomeScreen` passe `currentSchool.timezone` à `getTodayEstablishmentPresenceKpi`, avec fallback `Africa/Kinshasa`. |
| PARITY-082 | ALIGNÉ | #718 remplace le format locale courte du cooldown impayés par `formatDateForDisplay`; test explicite `17-09-2026`; `unpaidModule.ts` est désormais forcé dans la gate Date UI. |

## 5. Asymétries intentionnelles conservées

Ces écarts ne modifient pas la vérité métier canonique et sont retenus comme différences de canal, de rôle ou de facteur de forme.

| ID | Décision finale | Justification |
| --- | --- | --- |
| PARITY-010 | ASYMÉTRIE INTENTIONNELLE | Web garde `/backoffice/login`; Mobile garde `/identify` + `/login`. Permissions effectives et rôles canoniques sont hydratés après authentification. |
| PARITY-020 | ASYMÉTRIE UX | Web conserve les charts configurables ; Mobile privilégie les KPI/action cards par rôle. |
| PARITY-025 | WEB-ADMIN ONLY | Documents, conformité et export restent des surfaces d'administration lourdes côté Web ; aucun faux équivalent Mobile n'est exposé. |
| PARITY-036 | ROADMAP P2 | Mobile affiche ledger/historique parent ; l'intégration de paiement externe Mobile Money/carte reste explicitement P2. |
| PARITY-050 | ASYMÉTRIE DE CANAL | `POST /identify` est nécessaire au parcours Mobile téléphone/PIN ; le BackOffice Web n'en a pas besoin. |
| PARITY-054 | WEB-AUTHORING ONLY | Conception/configuration avancée des bulletins reste Web ; Mobile lit snapshots, historique et workflow publié. |
| PARITY-059 | ASYMÉTRIE DASHBOARD | Web expose une tuile « Parents & élèves » ; Mobile garde un dashboard rôle compact. Les relations elles-mêmes sont canoniques. |
| PARITY-062 | WEB-GOVERNANCE ONLY | CREATE/DELETE pays reste gouvernance Web ; Mobile ne duplique pas une console plateforme. |
| PARITY-064 | WEB-RBAC ONLY | L'éditeur de rôles/droits est Web/backend ; l'écran Permissions Mobile orphelin a été supprimé. |
| PARITY-065 | MOBILE-NATIVE | Offline, sync et support sont des capacités natives Mobile sans équivalent Web nécessaire. |
| PARITY-067 | ASYMÉTRIE UX AUTH | Les rôles plateforme utilisent des parcours UI différents Web/Mobile mais des identités canoniques communes. |
| PARITY-069 | WEB-AUTHORING / MOBILE-CONSUME | Le catalogue des salles est administré côté Web ; Mobile consomme `GET /school-rooms` dans le planning canonique. |
| PARITY-070 | MOBILE-NATIVE | Logout Mobile ajoute révocation push et blocage outbox ; Web n'a pas ces artefacts natifs. |
| PARITY-084 | ASYMÉTRIE UX | Mobile conserve un raccourci de contexte plateforme ; Web reste saisie manuelle. |
| PARITY-085 | ASYMÉTRIE DASHBOARD | Web charts et Mobile cartes rôle n'ont pas vocation à porter les mêmes libellés visuels tant que les données métier restent canoniques. |
| PARITY-086 | ALIGNÉ UX INTENTIONNEL | Tables Web vs cartes expansibles Mobile est une différence de facteur de forme explicitement retenue. |

## 6. Fermeture de PARITY-082 — PR #718

Le dernier résiduel détecté par le ré-audit final a été corrigé séparément.

PR : **#718 — PARITY-082 — date relance impayés JJ-MM-AAAA**

- HEAD fusionné : `4ffeabdc6ecd13913b2397348b378450cfa022a8`
- base pré-merge : `6bc1ceaf6eb597ca39317452bbf076285c5b8e03`
- merge commit : `0d5a3ae4fb65ec44c3e608be6abfaa5b402b0a35`
- parents vérifiés :
  1. `6bc1ceaf6eb597ca39317452bbf076285c5b8e03`
  2. `4ffeabdc6ecd13913b2397348b378450cfa022a8`
- signature GitHub : **verified / valid**
- `develop` pointe sur `0d5a3ae4fb65ec44c3e608be6abfaa5b402b0a35`.

Correction :
- suppression de `formatFrDate` ;
- suppression du `toLocaleDateString(... month: "short")` ;
- délégation à `formatDateForDisplay` ;
- test contractuel explicite du message `17-09-2026` ;
- `web/src/lib/unpaidModule.ts` ajouté aux fichiers forcés de la gate Date UI ;
- aucun changement de calcul Finance, ledger, cooldown, montant ou API.

CI exacte du HEAD #718 avant merge :
- PR Gates #1084 : **GREEN** ;
- Required : **GREEN** ;
- Risk-targeted : **GREEN** ;
- Quality : **GREEN** ;
- Core tests : **GREEN** ;
- LOT 0–8 : **GREEN** ;
- Date UI contract #73 : **GREEN** ;
- Finance F8 #286 : **GREEN** ;
- Architecture Audit : **GREEN** ;
- UI French Copy : **GREEN** ;
- Branding master : **GREEN**.

## 7. État CI et gouvernance de clôture

La dernière mutation produit de ce chantier est le merge #718.

État de référence final :
`develop@0d5a3ae4fb65ec44c3e608be6abfaa5b402b0a35`.

Toutes les corrections LOT 0–8 ont été fusionnées après diff GitHub indépendant CTO et contrôle anti-dérive.

La PR #704 reste **baseline historique uniquement** et ne doit pas être fusionnée.

La présente PR de rapport ne doit contenir **qu'un fichier documentaire**.

## 8. Risques résiduels

Aucun **blocker de parité Web ↔ Mobile** n'est ouvert après #718.

Risques/choix restant hors notion de défaut de parité :
1. les asymétries Web-only/Mobile-only de la section 5 sont intentionnelles et doivent rester protégées contre toute réintroduction legacy ;
2. les parcours de login Web/Mobile restent différents par conception ; la parité porte sur identité, permissions effectives, lockout et claims, pas sur une URL identique ;
3. les capacités natives Mobile (push, offline, outbox) conservent leurs contrôles propres ;
4. les fonctions explicitement classées roadmap P2 ne doivent pas être interprétées comme une régression de la V2 actuelle.

## 9. Décision CTO finale

**LOT 0–8 : CLOSED.**

**PARITY-082 : CLOSED via #718.**

**Chantier global Web ↔ Mobile : CLOSED GLOBAL.**

Critères de fermeture satisfaits :
- tous les IDs planifiés sont fermés ;
- tous les résiduels détectés au re-audit sont fermés ou documentés comme asymétries intentionnelles ;
- aucun legacy n'a été réactivé ;
- backend/PostgreSQL reste canonique ;
- les gates LOT 0–8 et Required sont vertes sur le dernier HEAD produit audité ;
- le dernier résiduel Date UI dispose désormais d'une couverture empêchant sa régression.

Toute évolution future des asymétries intentionnelles doit être traitée comme un **nouveau chantier produit**, et non comme une réouverture implicite de cet audit.
