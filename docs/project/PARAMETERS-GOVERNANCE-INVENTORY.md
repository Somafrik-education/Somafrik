# Audit métier — gouvernance des paramètres

**Dépôt :** `Somafrik-education/Somafrik`  
**Base auditée :** `develop@0a9513cfcd6b933b013f25e3ade438575a73161b`  
**Nature :** inventaire / audit uniquement  
**Correctif applicatif :** aucun

## 1. Objet

Cet audit cartographie la gouvernance actuelle de quatre familles de paramètres :

- niveaux scolaires ;
- filières / séries / options ;
- types d'évaluation ;
- rôles métier généraux d'établissement (Secrétaire, Préfet des études, Comptable, Directeur, etc.) et articulation avec les permissions.

L'objectif est de documenter l'état réel avant migration. Cette PR ne déplace aucun écran, ne crée aucune table, ne modifie aucune API, aucun RBAC et aucune donnée.

## 2. Synthèse métier

| Paramètre | État actuel constaté | Propriétaire métier actuel | Cible décidée | Écart |
|---|---|---|---|---|
| Niveaux | Liste libre par établissement dans `academicConfigs.levels`, avec valeurs par défaut Web | Admin établissement / rôles autorisés à la configuration | **Superadmin**, référentiel canonique par pays ; établissement = activation/sélection | Fort |
| Filières | Liste libre par établissement dans `academicConfigs.tracks`, avec valeurs par défaut Web | Admin établissement / rôles autorisés à la configuration | **Superadmin**, référentiel canonique par pays ; établissement = activation/sélection | Fort |
| Types d'évaluation | Liste par établissement dans `academicConfigs.evaluationTypes`, affichée sous « Année scolaire » | Admin établissement | **Admin établissement → Structure pédagogique** | Moyen : propriétaire correct, emplacement incorrect |
| Rôles généraux | Liste libre par établissement dans `academicConfigs.userRoles`; droits locaux pilotés dans la même configuration | Admin établissement | **Superadmin** pour le catalogue général + politique de permissions ; établissement = affectation/utilisation | Fort |
| Admin Pays / Admin School | Déjà pilotés par le Superadmin dans la matrice « Droits par rôle » | Superadmin | Superadmin | Aligné, mais gouvernance incomplète par rapport aux rôles généraux |

## 3. Cartographie actuelle — Web

### 3.1 Hub Paramètres

`web/src/App.tsx` expose actuellement trois routes de configuration établissement pertinentes :

- `/parametres/annee-scolaire` → `ConfigurationPage section="annee-scolaire"` ;
- `/parametres/structure` → `ConfigurationPage section="structure"` ;
- `/parametres/roles-droits` → `ConfigurationPage section="roles-droits"`.

La page commune est `web/src/pages/ConfigurationPage.tsx`.

### 3.2 Niveaux

Dans `ConfigurationPage`, la section `structure` permet de saisir librement une ligne par niveau. L'enregistrement écrit :

```text
academicConfigs[schoolCode].levels
```

Le fallback Web est défini dans `web/src/lib/academicConfig.ts` :

```text
1ère, 2ème, 3ème, 4ème, 5ème, 6ème
```

**Constat métier :** le vocabulaire de niveau est aujourd'hui créé/localisé au niveau de chaque établissement. Deux écoles d'un même pays peuvent donc produire des libellés différents pour le même niveau.

### 3.3 Filières

Dans la même section `structure`, l'établissement saisit librement les filières. L'enregistrement écrit :

```text
academicConfigs[schoolCode].tracks
```

Fallback Web actuel :

```text
Générale, Sciences, Lettres, Technique, Commerciale
```

**Constat métier :** les filières ne sont pas un référentiel pays canonique ; elles restent des chaînes libres propres à chaque établissement.

### 3.4 Types d'évaluation

`ConfigurationPage` enregistre :

```text
academicConfigs[schoolCode].evaluationTypes
```

mais le bloc UI est actuellement rendu dans la section **`annee-scolaire`**, à côté des périodes et du barème. Le fallback affiché est :

```text
Interrogation, Devoir, Examen
```

La saisie des évaluations consomme ensuite cette configuration dans `web/src/components/grades/EvaluationFormModal.tsx` via `getEvaluationTypes(state, schoolCode)` et utilise une liste de secours si aucune configuration n'est disponible.

**Constat métier :** le paramètre est déjà scopé à l'établissement et effectivement consommé par le domaine pédagogique, mais son emplacement fonctionnel « Année scolaire » mélange calendrier et structure pédagogique.

### 3.5 Rôles métier généraux

`web/src/lib/academicConfig.ts` définit encore un catalogue local par défaut :

```text
Secrétaire
Préfet des études
Enseignant
Parent
Élève / Étudiant
Comptable
Proviseur / Directeur
```

`ConfigurationPage section="roles-droits"` permet à l'établissement de remplacer cette liste par des chaînes libres dans :

```text
academicConfigs[schoolCode].userRoles
```

La même page permet également à l'Admin School de piloter des permissions des rôles locaux dans la limite de ses propres droits. Une modification de libellé peut provoquer une migration des références utilisateurs et de la matrice de permissions côté client avant persistance.

**Constat métier :** le nom, l'existence et une partie du pilotage de rôles structurants sont aujourd'hui délégués à chaque établissement. Cela empêche d'avoir un catalogue transversal stable pour le reporting, le support, les règles de sécurité et les futures politiques pays.

## 4. Gouvernance Superadmin actuelle

`web/src/pages/PermissionsPage.tsx` implémente déjà une matrice Superadmin, mais elle ne couvre explicitement que les rôles plateforme :

```text
Admin Pays
Admin School
```

Le parcours est :

```text
Pays → Établissement → rôle cible → module → droits CRUD
```

`web/src/lib/roleGovernance.ts` documente explicitement l'état actuel : les rôles métier d'établissement (Secrétaire, Préfet, Enseignant…) sont pilotés dans Configuration, tandis que `Admin Pays` et `Admin School` sont pilotés par la matrice Superadmin.

**Écart cible :** la gouvernance Superadmin doit être étendue au **catalogue des rôles généraux**, sans pour autant permettre à un établissement de s'octroyer des permissions hors de son plafond.

## 5. Persistance / legacy encore impliqué

Les quatre familles auditées sont regroupées, directement ou partiellement, dans `academicConfigs`.

`backend/lib/backOfficeWritableEntities.js` confirme que `academicConfigs` reste une clé modifiable via le chemin historique `PUT /api/backoffice/state` notamment pour `Admin School`, Préfet/Proviseur/Directeur adjoint, Directeur et Superadmin selon le périmètre autorisé.

À l'inverse, `rolePermissions` fait déjà partie des domaines exclus des écritures legacy globales et utilise les APIs plateforme dédiées dans le Web (`platformApi.replaceRolePermissions`).

**Conséquence :** le chantier futur ne doit pas seulement déplacer des cartes d'interface. Il doit sortir les référentiels concernés de `academicConfigs` lorsque leur propriétaire devient global/pays, puis retirer les anciennes écritures pour éviter une double source d'autorité.

## 6. Cible métier validée

### 6.1 Superadmin — Référentiels pédagogiques

Le Superadmin devient propriétaire du vocabulaire canonique, avec une portée **par pays** :

```text
Superadmin
└── Référentiels pédagogiques
    └── Pays
        ├── Niveaux
        └── Filières / Séries / Options
```

L'établissement ne crée plus arbitrairement ces référentiels. Il **active/sélectionne** ceux qu'il offre réellement.

Séparation conceptuelle attendue :

```text
catalogue pays canonique
        ↓
activation établissement
        ↓
classes / structure pédagogique réelle
```

### 6.2 Superadmin — Gouvernance des rôles généraux

Le Superadmin devient propriétaire du catalogue général des rôles : Secrétaire, Préfet des études, Comptable, Directeur, etc.

La future gouvernance doit distinguer au minimum :

- code canonique stable ;
- libellé ;
- portée (plateforme / pays / établissement) ;
- statut actif/inactif ;
- politique/plafond de permissions ;
- permissions de base lorsqu'elles sont standardisées.

L'Admin établissement conserve la capacité d'**affecter** un rôle autorisé à ses utilisateurs et, si le modèle de délégation est conservé, d'ajuster uniquement des droits explicitement délégables sous le plafond Superadmin.

`Enseignant`, `Parent` et `Élève / Étudiant` doivent être traités avec prudence lors du chantier : ce sont aussi des identités métier liées à des modules canoniques, pas seulement des fonctions administratives génériques. L'audit ne décide pas ici qu'ils deviennent créables via le module Utilisateurs ; les règles canoniques existantes restent inchangées.

### 6.3 Admin établissement — Structure pédagogique

`Types d'évaluation` reste un paramètre d'établissement, mais doit être déplacé fonctionnellement sous :

```text
Paramètres
└── Structure pédagogique
    └── Types d'évaluation
```

Le changement de navigation devra préserver son usage effectif lors de la création d'une évaluation.

## 7. Risques constatés avant migration

| Risque | Observation | Priorité future |
|---|---|---|
| Divergence inter-écoles | niveaux/filières/rôles libres par établissement | P1 |
| Couplage au legacy | paramètres audités encore rassemblés dans `academicConfigs` écrit via `PUT /api/backoffice/state` | P1 |
| Identité des rôles instable | renommage de rôle local peut entraîner migration de références et permissions | P1 |
| Gouvernance RBAC partagée | Superadmin gère Admin Pays/Admin School, établissement gère rôles locaux | P1 |
| Mauvais emplacement fonctionnel | types d'évaluation sous Année scolaire | P2 |
| Valeurs par défaut Web | niveaux/filières/rôles ont des fallbacks codés côté client | P2 |

## 8. Découpage recommandé des futurs correctifs

### PR A — Référentiels pédagogiques Superadmin

- modèles PostgreSQL canoniques pays pour niveaux et filières/séries/options ;
- administration Superadmin ;
- activation par établissement ;
- migration des consommateurs Web/Mobile/Backend ;
- tenant/pays, RBAC, audit et concurrence ;
- aucun fallback local utilisé comme source d'autorité.

### PR B — Gouvernance des rôles généraux

- catalogue canonique Superadmin ;
- permissions/plafonds ;
- affectation établissement ;
- suppression de la création/renommage arbitraire de rôles généraux par école ;
- compatibilité avec les rôles identitaires canoniques (enseignant notamment).

### PR C — Types d'évaluation / Structure pédagogique

- déplacement UI vers Structure pédagogique ;
- source d'autorité établissement explicite ;
- conservation du contrat consommé par création/édition d'évaluations ;
- audit et RBAC établissement.

### PR D — Nettoyage legacy paramètres

- retrait des clés devenues obsolètes de `academicConfigs` ;
- blocage fail-closed des anciennes écritures ;
- retrait des fallbacks dupliqués quand les APIs canoniques sont disponibles ;
- vérification Web + Mobile + Backend ;
- documentation de la nouvelle source d'autorité.

## 9. Gates CTO pour les futurs lots

Aucun lot de migration ne devra être mergé sans :

1. source d'autorité PostgreSQL unique clairement définie ;
2. scoping pays/établissement dérivé du principal, jamais d'un identifiant client non fiable ;
3. RBAC fail-closed ;
4. audit transactionnel pour les mutations de gouvernance ;
5. tests PostgreSQL et HTTP incluant isolation tenant, 403/404 et concurrence pertinente ;
6. suppression ou interdiction de l'ancienne écriture dans la même séquence de migration ;
7. diff GitHub indépendant CTO immédiatement avant merge.

## 10. Conclusion

**Verdict d'audit : migration justifiée.**

- **Niveaux :** gouvernance actuelle trop locale → Superadmin / référentiel pays.
- **Filières :** gouvernance actuelle trop locale → Superadmin / référentiel pays.
- **Rôles généraux :** gouvernance actuelle fragmentée → catalogue et politique Superadmin, affectation locale.
- **Types d'évaluation :** scope établissement correct, mais à repositionner sous Structure pédagogique.

Cette PR s'arrête à cet inventaire. **Aucun comportement applicatif n'est modifié.**
