# STOP opérateur — secrets VAPID Web Push (#646)

Le code Web Push est prêt, mais **l’envoi navigateur reste désactivé** tant que les
secrets VAPID ne sont pas posés **hors dépôt** (Render / secrets manager), par
environnement.

Cursor **ne génère pas**, **n’injecte pas** et **ne déploie pas** ces secrets.

## Variables à poser (opérateur)

Sur le service API uniquement (`somafrik-api-preprod`, API production, Docker local) :

| Variable | Rôle | Secret ? |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Clé publique servie à `GET /api/web/push-config` | Non (publique) |
| `VAPID_PRIVATE_KEY` | Signature Web Push | **Oui — jamais git, logs, PR, tests** |
| `VAPID_SUBJECT` | Contact VAPID, ex. `mailto:contact@somafrik.app` | Non |

Génération **hors dépôt**, une fois par environnement :

```bash
npx --yes web-push generate-vapid-keys
```

Coller les deux clés dans les secrets Render / `.env` local **non versionné**.
Ne pas les mettre dans `VITE_*` (le build Web ne doit pas embarquer la clé privée ;
la clé publique est lue à l’exécution via l’API authentifiée).

## Comportement sans secrets

- `GET /api/web/push-config` → `{ enabled: false, vapidPublicKey: null }`
- Le client n’appelle pas `PushManager.subscribe`
- Le fan-out Web Push est sauté (`vapid_not_configured`)
- L’inbox in-app et le Push Mobile Expo restent inchangés

## Actions hors périmètre Cursor

- Créer / coller les secrets Render préprod et prod
- Redéployer l’API après pose des secrets
- Vérifier Chrome/Edge non focalisé en préprod une fois les secrets posés

**STOP secrets / infra ici.** Aucune modification d’environnement depuis cette PR.
