# Audit — code établissement legacy encore visible dans Comptes utilisateurs

## Statut

- **Rapport Cursor livré :** `docs/audits/RAPPORT-CTO-USER-SCHOOL-CODE-DISPLAY-PREPROD.md`
- **Preuves runtime :** `docs/audits/evidence/user-school-code-display-preprod-runtime.json`
- **Verdict :** GO pour une **nouvelle** PR corrective. Cette PR #219 reste Draft.
- **Mode : audit uniquement**
- **Branche de base :** `develop@c7ffc56e163ea60f941d3579c228d1ede353679e`
- **Route préprod reproduite :** `/etablissement/comptes-utilisateurs`
- **Symptôme confirmé en préprod :** la modal d'un compte établissement affiche encore `CD-2026-0001` dans le champ **ÉTABLISSEMENT**, alors que l'identifiant utilisateur est déjà au format canonique et que le code établissement cible est `CD-IN-26-001`.
- **Aucun correctif métier dans cette PR.** Cursor doit d'abord établir la cause exacte de bout en bout.

## Contexte et tentatives déjà mergées

Trois corrections successives n'ont pas supprimé le symptôme en préprod :

1. **PR #215** — `getUserEstablishmentLabel()` sait résoudre `School.code`, `School.publicId` et `School.schoolCode`, puis préfère le code public.
2. **PR #217** — ajout du domaine `schools` au bootstrap de `/administration/utilisateurs`.
3. **PR #218** — pour les rôles établissement sans droit `schools`, résolution des établissements liés aux utilisateurs via `/api/schools/:code` dans le loader `users`.

La préprod affiche encore `CD-2026-0001`. Il est donc interdit de proposer une quatrième correction par hypothèse sans capturer les valeurs réelles traversant chaque couche.

## Contrat métier cible

Le code public établissement visible dans l'UI doit être le `schools.login_code`, par exemple :

```text
CD-IN-26-001
```

Le champ historique `schools.school_code` peut rester un alias technique temporaire si nécessaire pour la compatibilité interne, mais il ne doit plus être utilisé comme libellé public dans Comptes utilisateurs.

## Faits de code à vérifier

### PostgreSQL / backend établissements

`backend/lib/schoolsManagement.js` mappe actuellement une ligne établissement de cette manière :

- `publicId = login_code || profile.publicId || school_code`
- `code = school_code`
- `loginCode = login_code`
- `legacySchoolCode = school_code`

Donc un objet `School` peut légitimement transporter **les deux formats**.

### Projection utilisateurs PostgreSQL

`backend/db/clientsPgStore.js` charge actuellement les utilisateurs avec `s.school_code` dans plusieurs SELECT, notamment `listProjection()` et `getUserById()`.

Le mapping `backend/lib/clientsManagement.js::mapUserRow()` fait :

```js
const schoolCode = row.school_code ?? ...
```

et retourne ce `schoolCode` au Web.

Ce point est critique : l'API users continue donc à exposer l'alias historique comme périmètre utilisateur.

### Web

`web/src/lib/userAccounts.ts::getUserEstablishmentLabel()` cherche l'établissement correspondant dans la liste reçue. Si aucun établissement n'est trouvé, il fait encore :

```ts
if (!school) return user.schoolCode as string;
```

Ce fallback peut réafficher directement `CD-2026-0001`.

`web/src/pages/UsersPage.tsx` construit `schoolsForLabels` depuis `scopedSchools(scopeUser, state)` puis appelle `getUserEstablishmentLabel(detail, schoolsForLabels)`.

## Mission Cursor — audit obligatoire avant correction

Cursor doit tracer la valeur exacte affichée en préprod depuis PostgreSQL jusqu'au DOM, sans supposer que #215/#217/#218 ont produit les objets attendus.

### 1. Capturer la vérité PostgreSQL

Pour l'établissement du compte affiché, relever au minimum :

```sql
SELECT id, school_code, login_code, short_code, name
FROM schools
WHERE upper(school_code) = upper('CD-2026-0001')
   OR upper(coalesce(login_code, '')) = upper('CD-2026-0001')
   OR upper(coalesce(login_code, '')) = upper('CD-IN-26-001');
```

Puis le compte concerné :

```sql
SELECT u.id, u.user_code, u.school_id, u.role, s.school_code, s.login_code, s.name
FROM users u
LEFT JOIN schools s ON s.id = u.school_id
WHERE u.user_code = '<USER_CODE_CONCERNE>';
```

Le rapport doit indiquer les valeurs exactes de `school_code` et `login_code` présentes en préprod.

### 2. Capturer la réponse HTTP réelle de `/api/backoffice/users`

Pour le compte concerné, relever les champs reçus par le Web :

- `schoolCode`
- `schoolId`
- tout éventuel `schoolLoginCode`, `loginCode`, `schoolName` ou équivalent

Ne pas déduire ces champs depuis les types TypeScript : inspecter la réponse réseau réelle ou reproduire par test d'intégration backend.

### 3. Capturer la réponse HTTP réelle de `/api/schools/CD-2026-0001`

Vérifier explicitement :

- code HTTP ;
- `code` ;
- `publicId` ;
- `schoolCode` ;
- `loginCode` ;
- `name`.

Si l'endpoint renvoie encore `code = CD-2026-0001` sans `publicId = CD-IN-26-001`, le bug est backend/projection établissement et non dans la modal.

### 4. Vérifier l'exécution réelle de #218

Sur `/etablissement/comptes-utilisateurs`, confirmer par instrumentation/test que :

- `clientsApi.listUsers()` est appelé ;
- `clientsApi.resolveUserSchools()` est réellement appelé après `listUsers()` ;
- la requête `/schools/CD-2026-0001` part réellement du navigateur ;
- elle réussit ;
- la tranche retournée par le loader contient bien `schools` ;
- `DataContext` conserve cette clé `schools` après merge de la tranche ;
- aucune autre actualisation de domaine n'écrase ensuite `state.schools` avec `[]` ou un autre ensemble.

### 5. Vérifier le filtrage de scope

Dans `UsersPage.tsx`, capturer au moment d'ouvrir la modal :

```text
detail.schoolCode
state.schools
schoolsForLabels
getUserEstablishmentLabel(detail, schoolsForLabels)
```

Le rapport doit montrer laquelle de ces valeurs explique précisément le retour `CD-2026-0001`.

### 6. Vérifier les caches navigateur / déploiement

Confirmer le SHA réellement servi par la préprod Web. Le backend peut être sur un SHA récent alors que le frontend statique est encore sur un build précédent.

À vérifier :

- SHA/build Web déployé ;
- présence effective du code #218 dans le bundle servi ;
- cache CDN / service worker / navigateur ;
- environnement `preprod.somafrik.app` distinct éventuel de `api-preprod.somafrik.app`.

Cette vérification est obligatoire car la capture provient du domaine Web `preprod.somafrik.app`.

## Hypothèses à départager par preuve

Cursor doit conclure explicitement pour chacune : **confirmée / infirmée**, avec preuve.

1. Le Web préprod sert encore un bundle antérieur à #218.
2. `/api/schools/CD-2026-0001` ne retourne pas le `login_code` attendu.
3. `resolveUserSchools()` n'est pas exécuté sur cette route réelle.
4. La tranche `schools` retournée par le loader `users` est perdue/écrasée dans `DataContext`.
5. `scopedSchools()` élimine l'établissement canonique pour le rôle Préfet.
6. Le `School` résolu ne transporte pas l'ancien alias permettant la correspondance avec `user.schoolCode`.
7. La modal affichée n'utilise pas le helper ou le composant supposé.
8. Un autre mapping ou composant retransforme le code canonique en `school_code` avant affichage.

## Correction attendue après audit

La future PR de correction doit privilégier une solution **à la source** : la projection utilisateur devrait idéalement transporter directement le code public de son établissement depuis la jointure PostgreSQL (`s.login_code`) et le nom (`s.name`), plutôt que demander au Web de recroiser un deuxième domaine pour produire un simple libellé.

Exemple de contrat API souhaitable à valider pendant l'audit :

```json
{
  "schoolId": "<uuid>",
  "schoolCode": "CD-2026-0001",
  "schoolPublicCode": "CD-IN-26-001",
  "schoolName": "..."
}
```

ou, mieux à terme, renommer clairement l'alias legacy pour éviter l'ambiguïté :

```json
{
  "schoolId": "<uuid>",
  "legacySchoolCode": "CD-2026-0001",
  "schoolCode": "CD-IN-26-001",
  "schoolName": "..."
}
```

Aucune modification de contrat ne doit être faite avant d'avoir inventorié tous les consommateurs de `UserAccount.schoolCode` (auth, scope tenant, création utilisateur, permissions, filtres, Mobile).

## Tests obligatoires de la future correction

La future PR corrective doit inclure au minimum :

1. test repository/projection PG prouvant qu'un utilisateur lié à une école `school_code=CD-2026-0001`, `login_code=CD-IN-26-001` expose le code public ;
2. test API `/api/backoffice/users` sur ce même cas ;
3. test Web de la modal avec **aucun domaine `schools` chargé** ;
4. test Web avec rôle établissement réel (ex. Préfet des études) ;
5. test empêchant toute chaîne `CD-2026-0001` dans le champ visuel **ÉTABLISSEMENT** lorsque `login_code` existe ;
6. test de non-régression des scopes tenant : l'identifiant utilisé pour l'autorisation ne doit pas changer silencieusement ;
7. preuve E2E préprod sur `/etablissement/comptes-utilisateurs` après déploiement.

## Critères de sortie de l'audit Cursor

Cursor doit revenir avec :

- SHA exact de `develop` audité ;
- réponse des deux requêtes PostgreSQL ;
- réponse réelle `/api/backoffice/users` pour le compte ;
- réponse réelle `/api/schools/:code` ;
- valeurs runtime `detail.schoolCode`, `state.schools`, `schoolsForLabels` ;
- SHA du bundle Web réellement servi en préprod ;
- cause racine unique démontrée ;
- liste exhaustive des fichiers/tables à modifier ;
- proposition de correction minimale ;
- tests à ajouter ;
- **aucune modification de code dans la PR d'audit**.

## Gate CTO

Cette PR d'audit doit rester **Draft**. Aucun Ready, aucun merge. Après livraison de l'audit Cursor et avant toute future fusion d'un correctif, effectuer un **diff GitHub indépendant** de la PR corrective.