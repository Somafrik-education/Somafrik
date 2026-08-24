# Limites et points non documentés comme parcours validés

Ce fichier empêche le guide utilisateur de transformer une capacité partielle, une divergence Web/Mobile ou une hypothèse en procédure officielle.

Référence : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`.

## 1. Captures runtime — lot W01→W06 intégré, reste à capturer

Les captures Web **W01 à W06** sont désormais issues d'une instance Somafrik réellement exécutée (Web Vite + API canonique + PostgreSQL) et marquées `VALIDÉE` dans `CAPTURES-METIER.md`. Les lignes W07+ et tout le lot Mobile restent `À CAPTURER`.

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

## Gate d'évolution du guide

Pour retirer une réserve :

1. vérifier le code au nouveau HEAD `develop` ;
2. exécuter le scénario avec le rôle concerné ;
3. confirmer l'écriture/lecture backend lorsque le scénario mute des données ;
4. capturer l'écran réel ;
5. mettre à jour le guide + `CAPTURES-METIER.md` ;
6. faire relire le diff GitHub indépendamment avant merge.
