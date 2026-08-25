# Limites et points non documentés comme parcours validés

Ce fichier empêche le guide utilisateur de transformer une capacité partielle, une divergence Web/Mobile ou une hypothèse en procédure officielle.

Référence : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`.

### 1. Captures runtime — lot W01→W06 et Mobile M01–M23

Les captures Web **W01 à W06** et le lot Mobile **M01–M18**, **M20–M23** sont désormais issues d'une instance Somafrik réellement exécutée et marquées dans `CAPTURES-METIER.md`. **M11** reste `À REVALIDER`. **M19** est `BLOQUÉE`. Les lignes Web W07+ restent `À CAPTURER`.

**Décision documentation :** aucun mockup n'est utilisé comme remplacement temporaire.

## 2. Classes — présélections à vérifier avant validation

Les formulaires Web et Mobile de création de classe peuvent initialiser certaines sélections à partir du premier élément actif du catalogue (année/niveau/groupe selon l'interface).

**Consigne guide :** demander à l'utilisateur de vérifier les valeurs sélectionnées avant d'enregistrer ; ne jamais décrire une présélection comme une recommandation métier.

## 3. Classes — vocabulaire pédagogique dépendant du pays

Les libellés Niveau / orientation / Groupe viennent du catalogue et des labels pays. Une capture réalisée avec un pays ne doit pas être utilisée pour prétendre que la même terminologie s'applique à tous les pays.

## 4. Enseignants — différence de point d'entrée Web/Mobile

- Web : l'écran `Enseignants` indique que la création d'identité se fait depuis `Comptes utilisateurs` ;
- Mobile : le composant métier expose actuellement `Créer un enseignant` pour les sessions habilitées et appelle le workflow canonique serveur de création d'identité enseignant.

**Décision documentation :** conserver deux procédures distinctes. Ne pas forcer une fausse parité de libellé.

## 5. Matrice des droits — Web uniquement

Le Mobile peut créer/modifier certaines identités et attribuer le rôle Enseignant lorsqu'autorisé, mais la modification de la matrice complète des droits reste explicitement présentée comme une fonction Web.

## 6. Parent-enfant

La route Web de relations parent-enfant existe, mais aucun parcours d'écriture parent-enfant n'est publié dans ce guide tant que le workflow runtime complet identité → rôle Parent → relation → rechargement canonique n'a pas été revalidé sur le SHA courant.

La consultation d'un écran existant ne suffit pas à certifier une mutation.

## 7. Paramètres Mobile

Le menu actuel contient `Paramètres` et `Structure pédagogique` dans le catalogue des rôles internes d'établissement, mais chaque entrée reste filtrée par `canReadView`, `canReadRoute` et les permissions de la session.

**Décision documentation :** le guide décrit leur présence possible, pas une disponibilité universelle.

## 8. Mode hors ligne / outbox

Certaines mutations protégées (notamment paiements, appels et notes) peuvent être placées en file d'attente. Le code distingue `confirmed`, `queued` et `failed`.

**Décision documentation :** `queued` n'est jamais décrit comme un enregistrement serveur réussi.

## 9. Suppression, archivage et désactivation

Les libellés UI ne doivent pas être interprétés sans le comportement métier :

- Élèves Web : `Archiver` ;
- Enseignants Web : une action visible `Supprimer` conduit au cycle d'archivage/désactivation du compte d'accès ;
- Enseignants Mobile : `Archiver` ;
- Classes : `Désactiver`.

Le guide emploie le terme correspondant au résultat métier lorsqu'il peut éviter une mauvaise interprétation.

## 10. Fonctions existantes mais non détaillées dans cette V1

Les routes/écrans suivants peuvent exister et être accessibles selon le RBAC, mais ne reçoivent pas encore une procédure pas-à-pas tant qu'un scénario runtime et sa capture ne sont pas validés :

- certaines actions de Bulletins ;
- certaines actions Documents ;
- Rapports détaillés ;
- Paiement mobile Parent ;
- opérations avancées de Synchronisation ;
- actions détaillées de Salles / Remplacements / Conflits ;
- certaines configurations plateforme.

Ils peuvent être mentionnés comme modules visibles, mais pas comme workflows garantis.

## 11. Seed démo PostgreSQL — boot local cassé sans contournement ops

Rôle / contexte : runtime local `backend:pg` + `shouldSeedDemoData()`.

Comportement attendu : un `npm run backend:pg` sur base vide charge le jeu démo et reste relançable.

Comportement observé sur le SHA du guide :

- `seedIfEmpty` échoue sur `uq_subscriptions_school_id` (le seed construit 50 abonnements et répète le premier établissement) ;
- l'insert élèves du seed lève `STUDENT_CANONICAL_IDENTIFIER_REQUIRED` (matricules legacy `CD-IN-EL-26-00x` vs trigger d'identité canonique) ;
- `node backend/scripts/seed-platform-bulk.js` échoue sur `STUDENT_INITIALS_REQUIRED` ;
- une relance après seed échoue sur `CANONICAL_SCHOOL_COURSE_AMBIGUOUS` puis `USER_ROLES_MIGRATION_AMBIGUOUS` (rôles démo générés hors catalogue).

Impact guide : le lot W01→W06 a dû utiliser un wrapper de process hors dépôt (déduplication des abonnements, exclusion des comptes Élève du seed, stub des deux contrôles de relance). Aucun fichier `backend/` / `web/src/` n'a été modifié.

Sévérité proposée : P1 — bloque un boot PG démo reproductible.

## 12. Code établissement public ≠ code interne affiché

Rôle : Admin établissement. Routes : `/connexion`, `/tableau-de-bord`, `/etablissement/*`.

Comportement attendu : le code saisi à la connexion et le périmètre affiché dans le chrome sont le même identifiant public.

Comportement observé : le trigger `somafrik_prepare_school_login_code` a émis `CD-UK-26-001` à partir du nom seed « Universite de Kinshasa » (ensuite renommé **Institut Nouvelle Espérance** via l'API Superadmin). Le chrome Web affiche `Périmètre établissement : CD-2026-0001` (school_code interne).

Impact guide : les légendes W01–W06 ne présentent pas `CD-IN-26-001` comme le code runtime de cette instance. La connexion établissement utilise le login public réel.

Sévérité proposée : P2 — ambiguïté d'identifiant, pas un blocage de parcours.

## 13. Tableau de bord — effectifs élèves non alignés sur l'annuaire

Rôle : Admin établissement. Route : `/tableau-de-bord`.

Comportement attendu : les cartes Scolarité / Effectifs par classe reflètent les élèves inscrits rechargés depuis PostgreSQL.

Comportement observé : après inscription canonique de 3 élèves dans `6ème A` (`POST /api/classes/:classCode/students`), le tableau de bord montrait un effectif élèves à 0 et « Aucune donnée à afficher » pour Effectifs par classe, alors que la liste Classes (filtre `6ème`) affichait effectif 3 et l'annuaire listait les 3 élèves.

Impact guide : W02 documente les indicateurs réellement chargés, pas une cohérence garantie avec W03/W05.

Sévérité proposée : P2 — divergence de synthèse, le parcours Classes / Élèves reste fiable.

## 14. Captures Mobile — runtime Expo web, pas d'APK/émulateur natif

Rôle / contexte : lot M01–M23.

Comportement attendu : application mobile native ou APK/preview branchée au backend canonique.

Comportement observé : aucun émulateur Android/APK n'était disponible. Les captures proviennent de l'application **Mobile Expo/React Native exécutée en web** (`npx expo start --web`) connectée à l'API canonique + PostgreSQL, mêmes sources `Mobile/src`. Badge « Développement » masqué pour le guide.

Impact guide : les images sont le runtime Mobile réel, pas une maquette, mais le chrome est un viewport 390×844 web plutôt qu'un device OEM.

Sévérité proposée : P2 — fidélité produit oui, chrome OS non natif.

## 15. Seed démo — classes et enseignants dupliqués

Rôle : Admin établissement. Écrans : Classes, Enseignants.

Comportement attendu : une classe **6ème A** et un enseignant **Patrick Ilunga** uniques.

Comportement observé : le seed gonfle ~50 classes / enseignants. Plusieurs cartes **6ème A** (ex. `CLS-2026-000001` et `CLS-2026-000005`) et plusieurs cartes Patrick Ilunga.

Impact guide : M02/M07 montrent le runtime réel, y compris les doublons. Le libellé catalogue est **6ème A**, pas « 6e A » ni « 1ère Scientifique ».

Sévérité proposée : P2 — bruit visuel, pas un faux écran.

## 16. Paiements Mobile — l'état vide masque « Saisir un paiement »

Rôle : Admin / Comptable. Écran : Paiements.

Comportement attendu : le bouton de création reste visible lorsque `Paiements:CREATE` est accordé, y compris liste vide.

Comportement observé : `PaymentsScreen` n'affiche `PaymentMutationControls` que si `paymentsSnapshot.status === "success"`. Une liste vide (`empty`) remplace tout l'écran par l'état vide, sans bouton.

Impact guide : M12–M14 ont exigé au moins un reçu déjà confirmé. Le guide le signale explicitement.

Sévérité proposée : P2 — le parcours de premier paiement est masqué.

## 17. Attribuer Enseignant — confirmation native non capturable

Rôle : Admin établissement. Écran : Utilisateurs.

Comportement attendu : une confirmation métier screenshotable (**Attribuer**).

Comportement observé : `Alert.alert("Attribuer le rôle Enseignant", …)` → dialogue navigateur, hors canvas.

Impact guide : M11 est `À REVALIDER` (bouton réel, pas la boîte de confirmation).

Sévérité proposée : P3 — documentation, pas un blocage métier.

## 18. Notes enseignant — cours/périodes absents + write_notes suspendu

Rôle : Enseignant. Écran : Notes / Nouvelle évaluation / Saisie des notes.

Comportement attendu : l'enseignant voit ses classes/cours de session et peut créer une évaluation, puis saisir après validation.

Comportement observé :

- `GET /api/assignments` exige `Affectations:READ` / `Enseignants:READ` ; l'enseignant n'a ni l'un ni l'autre. `loadAssignments` échoue silencieusement → **« Aucun cours autorisé pour votre session. »** et **« Aucune période canonique chargée. »** alors que le login expose bien des affectations ;
- `POST /api/evaluations` est refusé : *« L'accès à la plateforme est suspendu pour cet établissement (abonnement expiré ou impayé). »* (`write_notes`) ;
- le Préfet a `Notes:READ` seulement, pas `Notes:UPDATE` : il ne valide pas non plus.

Impact guide : M17/M18 documentent l'écran réel. **M19 BLOQUÉE**. Aucun correctif produit dans cette PR.

Sévérité proposée : P1 — bloque le parcours notes enseignant documenté.

## 19. Parent seed — aucun enfant lié ; téléphone d'inscription ≠ compte parent

Rôle : Parent. Écran : Accueil.

Comportement attendu : le parent voit l'enfant lié (profil, notes, présences, frais).

Comportement observé : `+243 820 000 001` se connecte en `parent_student` avec `children: []`. Le téléphone saisi à l'inscription élève (`+243 820 111 001`) ne crée pas de login parent. Réutiliser le téléphone seed à l'inscription heurte `uq_users_school_phone`.

Impact guide : M20 montre l'accueil parent réel sans enfant (identité compacte « Élève », KPI 0/0). Aligné sur la réserve #6.

Sévérité proposée : P1 — le parcours parent documenté n'est pas un suivi d'enfant.

## 20. Accueil élève — switcher sans dossier sélectionné

Rôle : Élève. Écran : Accueil.

Comportement attendu : le nom de l'élève connecté (ex. Grace Mbala) dans l'identité.

Comportement observé : pour `parent_student` et `student`, l'identité utilise `selectedStudent?.name ?? "Élève"`. Sans sélection, l'accueil affiche **Élève**.

Impact guide : M21 est l'accueil réel ; les onglets Notes / Présence / Frais sont présents.

Sévérité proposée : P3 — libellé d'identité, les onglets métier sont corrects.

## 21. Classes homonymes — appel enseignant ≠ inscription admin

Rôle : Enseignant vs Admin. Écrans : Appel, Élèves.

Comportement attendu : **6ème A** désigne la même classe.

Comportement observé : les élèves du jeu guide (Esther/Jean/Amina) sont sur `CLS-2026-000001`. L'affectation de Patrick Ilunga pointe une autre **6ème A** (`CLS-2026-000035`). `GET /students` enseignant ne remonte que cette dernière. L'appel M16 montre Esther Okito `CD-UK-OE-26-00006` inscrite dans la classe affectée, distincte de `CD-UK-OE-26-00001`.

Impact guide : ne pas fusionner les deux Esther. L'enseignant ne « voit » pas automatiquement l'annuaire admin.

Sévérité proposée : P1 — scoping réel, risque de mauvaise procédure.

## Gate d'évolution du guide

Pour retirer une réserve :

1. vérifier le code au nouveau HEAD `develop` ;
2. exécuter le scénario avec le rôle concerné ;
3. confirmer l'écriture/lecture backend lorsque le scénario mute des données ;
4. capturer l'écran réel ;
5. mettre à jour le guide + `CAPTURES-METIER.md` ;
6. faire relire le diff GitHub indépendamment avant merge.
