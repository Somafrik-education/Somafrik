# Audit fonctionnalités → API → PostgreSQL

## But

Vérifier qu'une fonctionnalité visible n'existe pas uniquement dans l'état React/Mobile, un JSON historique ou un runtime, mais possède une chaîne persistante explicite :

`UI → API dédiée → service/repository → table PostgreSQL → relations/FK → relecture canonique`

Le scanner `scripts/audit-feature-pg-relations.js` couvre les 27 domaines de `DOMAIN_KEYS` et recherche :

- preuve d'une famille d'API ;
- preuve des tables PostgreSQL attendues ;
- présence de relations FK vers les agrégats centraux.

## Exécution

```bash
node scripts/audit-feature-pg-relations.js
node scripts/audit-feature-pg-relations.js /tmp/somafrik-feature-pg.json
```

## Interprétation

- `CANONICAL_CANDIDATE` : API + tables détectées ; revue transactionnelle encore nécessaire.
- `NO_API_EVIDENCE` : données/tables possibles mais aucune API détectée dans les chemins audités.
- `NO_SCHEMA_EVIDENCE` : API détectée mais table attendue absente de `schema.sql` ; vérifier les migrations/boot SQL avant de conclure.
- `NO_API_NO_TABLE` : fonctionnalité potentiellement locale/legacy — priorité d'audit maximale.

## Points déjà confirmés manuellement

### P0/P1

1. **Users** : API dédiée `/api/backoffice/users`, table `users`, relation `user_roles`, rattachement `schools`. La panne observée le 15/08/2026 est un défaut de propagation de scope client, pas une absence de persistance PostgreSQL.
2. **Contacts / relations / messages / annonces** : APIs clients dédiées et structures PostgreSQL relationnelles existent.
3. **Examens / bulletins / documents** : mutations Web routées via `examsApi`, `reportCardsApi`, `schoolDocumentsApi`; elles ne doivent plus revenir dans `DataContext.update()`.
4. **academicConfigs** : dernier domaine encore pris en charge par `residualBackOfficeSync`. Il possède une API dédiée et une persistance PostgreSQL, mais conserve une architecture de synchronisation résiduelle à supprimer.
5. **BackOfficeState / DataContext** : reste un agrégat frontend de lecture, alors que les domaines sont chargés par APIs dédiées. Les nouvelles fonctionnalités ne doivent jamais ajouter de nouveau write JSON.

## Revue relationnelle obligatoire après le scanner

Pour chaque domaine `CANONICAL_CANDIDATE`, compléter :

| Domaine | Mutation API | Transaction | Table principale | FK tenant | FK identité | Audit serveur | GET canonique | Verdict |
|---|---|---|---|---|---|---|---|---|

Les cas sans FK métier volontaire (référentiels globaux, configuration JSONB structurée) doivent être documentés explicitement.

## Critères NO-GO

Une fonctionnalité est NO-GO si l'un des cas suivants est démontré :

- bouton Enregistrer sans mutation API ;
- mutation locale suivie uniquement d'un `setState` ;
- API qui écrit uniquement un snapshot JSON legacy ;
- donnée enfant sans FK ou contrôle de tenant permettant un orphelin ;
- POST réussi mais GET canonique incapable de relire la ligne ;
- suppression/archivage qui laisse une relation active orpheline ;
- divergence Web/Mobile sur la même opération métier.

Aucun correctif métier n'est inclus dans cette PR d'audit. Les anomalies confirmées doivent être ouvertes en lots correctifs séparés, chacun avec diff CTO indépendant avant merge.
