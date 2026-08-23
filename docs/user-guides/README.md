# Guides utilisateurs Somafrik

Version de référence : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`.

Ces guides décrivent **uniquement les interfaces Web et Mobile canoniques réellement présentes dans Somafrik**. Le BackOffice legacy n'est ni une source de vérité, ni une interface utilisateur documentée.

## Guides

- [Guide utilisateur Web](./GUIDE-UTILISATEUR-WEB.md)
- [Guide utilisateur Mobile](./GUIDE-UTILISATEUR-MOBILE.md)
- [Registre des captures métier réelles](./CAPTURES-METIER.md)
- [Runbook captures Web W01 à W06](./CAPTURE-RUNBOOK-WEB-W01-W06.md)
- [Limites et points non documentés](./KNOWN-ISSUES.md)

## Principe de documentation

Une fonction n'est décrite que si son écran, son contrôle de permission et son chemin métier ont été vérifiés dans le code exécuté de `develop`. Les libellés des boutons et champs reproduisent l'interface actuelle.

Les captures intégrées dans `assets/` doivent provenir d'une **instance Somafrik réellement exécutée** avec des données fictives. Les maquettes, reconstructions graphiques, écrans du BackOffice legacy et captures d'anciennes versions sont interdits.

## Permissions

Somafrik adapte les menus et les actions au rôle et aux permissions effectives. Deux utilisateurs peuvent donc voir des boutons différents sur un même écran. L'absence d'une action n'est pas nécessairement une anomalie : elle peut être liée au RBAC.

## Convention des captures

Le fichier `CAPTURES-METIER.md` définit pour chaque illustration :

- l'écran métier source ;
- le rôle de test ;
- l'état à afficher ;
- le fichier source du composant ;
- le chemin cible dans `assets/` ;
- le statut de validation.

Aucune image ne doit être ajoutée au guide avant validation de son origine réelle.
