# Audit global Communications Somafrik — TESTS FIRST

**Audit initial :** 7 septembre 2026  
**SHA audité initialement :** `6982f3141b8777049845ce178ebf7fdf4001e5a8`  
**Mise à jour :** 8 septembre 2026  
**Baseline actualisée :** `develop@dc34fd43ea2428c29158b9c892eeec2d02d08e8b`  
**PR audit :** #543

## Mise à jour après GREEN A/B

L’audit initial avait identifié plusieurs écarts RED. Deux d’entre eux sont maintenant corrigés et mergés :

- **P1-PUSH-SCHOOL / RED-COM-02 — corrigé par #544** : le ciblage Expo est désormais strictement filtré par `user_id + school_id + backend_environment`; le self-test utilise l’école canonique de session.
- **P1-FANOUT / RED-COM-01 — corrigé par #545** : après la persistance C4 in-app, le worker déclenche un fan-out PUSH/EMAIL découplé via `communicationChannelFanout.js`.
- **RED-COM-01b reste un contrat GREEN** : `communicationsNotificationsService.js` / `processOneEvent` restent sans Expo/SMTP.
- **Idempotence PR B** : `delivery_key` est unique et les leases `processing` périmés ne sont jamais redispatchés ; la stratégie retenue est at-most-once pour éviter les doubles envois.

Le fichier de test historique RED a donc été remplacé dans cette branche par `backend/lib/communicationsGlobalArchitecture.audit.test.js`, qui ne contient plus de RED volontaire et fige uniquement les contrats désormais corrigés.

## Architecture réelle actuelle

```text
Événement métier
→ transaction métier
→ communication_event_outbox
→ C4 persiste communication_notifications + notification_recipients
→ fan-out après persist
   → PUSH Expo (user + school + environnement)
   → EMAIL Nodemailer générique via SMTP_*
```

Le fournisseur externe n’est jamais source de vérité et un échec PUSH/EMAIL ne rollback pas la transaction métier ni la notification in-app.

Les autres surfaces restent séparées :

- C2 messages ;
- C3 annonces établissement ;
- annonces plateforme ;
- C4 notifications internes ;
- SMTP demande d’essai ;
- Expo Push N1 ;
- legacy `notifications` / `communicationService.js`.

## Écarts encore ouverts

### P1 / prochains lots

- **C — reset mot de passe transactionnel** : le reset persiste et révoque les sessions mais n’envoie pas encore d’e-mail transactionnel dédié.
- **D — dispatcher mince** : pas encore de façade unique `IN_APP | PUSH | EMAIL` au-dessus des adaptateurs.
- **E — préférences utilisateur** : aucune table canonique de préférences de canal.
- **F — consolidation legacy / UI** : anciennes surfaces notifications et annonces plateforme restent séparées.
- **G — SMTP demande d’essai** : `setImmediate` reste hors outbox orchestrée.

Ces écarts ne sont plus matérialisés par des tests volontairement rouges dans #543 afin de ne pas garder une PR d’audit impossible à intégrer. Ils doivent recevoir leurs propres RED tests dans les PR GREEN correspondantes avant implémentation.

## Contrats désormais figés par l’audit

`backend/lib/communicationsGlobalArchitecture.audit.test.js` vérifie :

1. le fan-out se produit après `drainOutbox` ;
2. `processOneEvent` reste sans fournisseur externe ;
3. le ciblage Expo reste scoped `user + school + environnement` ;
4. un `processing` périmé n’est pas redispatché ;
5. `delivery_key` reste unique dans le schéma et la migration.

## Risques résiduels assumés

La stratégie PR B privilégie l’absence de doublon : un crash après claim et avant l’appel fournisseur peut mener à un envoi perdu lorsque le lease est ensuite fermé en `skipped`. Ce compromis est explicite et doit rester documenté tant qu’aucun mécanisme fournisseur ne garantit une idempotence externe forte.

## Gouvernance

Cette PR d’audit ne doit contenir aucun correctif métier supplémentaire. Toute correction C→G doit rester dans une PR dédiée avec RED → GREEN, diff indépendant et non-régressions du périmètre modifié avant merge.

`main`, Render et production restent hors périmètre.
