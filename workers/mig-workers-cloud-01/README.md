# MIG-WORKERS-CLOUD-01

Préparation d'une expérimentation Cloudflare réelle. Rien n'est déployé.

Les composants exécutables viennent de la PR #1027, commit `e7513c5b5a11c3824ec320116e058c3db8e54ff9`, copiés sans modification dans `workers/mig-workers-poc-01/`. Cette branche ne fusionne pas #1027 et ne reprend pas ses autres fichiers.

`wrangler.prepared.jsonc` nomme les bindings `BROWSER`, `HYPERDRIVE` et `NOTIFY_QUEUE`. L'identifiant Hyperdrive est `PENDING_CTO_AUTHORIZATION`. Il n'y a pas de `localConnectionString`, pas de `account_id`, pas de route, et `workers_dev` reste faux.

Les quatre preuves Cloudflare sont `BLOCKED` tant que le compte et l'autorisation CTO manquent. Un succès Wrangler local ne les fait pas passer.

Le rapport est `docs/audits/MIG-WORKERS-CLOUD-01.md`.
