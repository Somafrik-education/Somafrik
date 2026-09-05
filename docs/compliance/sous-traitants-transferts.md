# Sous-traitants et transferts

**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`  
**Date de consignation :** 5 septembre 2026  
**Méthode :** métadonnées live des services + documentation prestataire publique. Les secrets (`DATABASE_URL`, clés, tokens) ne sont **pas** recopiés.

## Prestataires utilisés par l’application

| Prestataire | Finalité | Catégories | Lieu constaté | Mécanisme contractuel | Durée / sortie | Preuve |
|---|---|---|---|---|---|---|
| **Render** | API Node + site Web | Transit, journaux hébergeur, fichiers du volume PJ | **Frankfurt, Allemagne** pour l’API production — métadonnée live du service `Somafrik-api-prod` (`srv-dac22v8jo6nc739b3t9g`). Le CDN du site Web peut utiliser des points de présence distincts. | [DPA GDPR Render](https://render.com/dpa) ; sous-traitants publiés sur [render.com/security](https://render.com/security) | fin de contrat / suppression du service Render | métadonnées Render 5 sept. 2026 ; `docs/compliance/preuves-transferts-2026-09-05.md` |
| **Supabase** | PostgreSQL | Données métier | **AWS eu-west-1, Irlande (EEE)** pour le projet production `loyubruyrxcaeshonkwp`, statut `ACTIVE_HEALTHY`. | [DPA Supabase](https://supabase.com/downloads/docs/Supabase+DPA+260317.pdf) ; SCC/UK Addendum selon les traitements concernés | révocation Data API ; sauvegardes = politique prestataire | métadonnées projet Supabase 5 sept. 2026 ; `docs/compliance/preuves-transferts-2026-09-05.md` |
| **Expo** | Push Android + EAS | Jeton push, métadonnées d’appareil / build | **États-Unis, GCP** pour le service push selon la documentation Expo | Conditions Expo / SCC et garanties publiées par Expo | révocation du jeton / rebuild | documentation Expo ; code `Mobile/` push devices |
| **GitHub** | CI / dépôt | Code, journaux CI (**pas** le dossier scolaire) | Infrastructure GitHub distribuée | [DPA GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-dpa) | rétention logs CI | `.github/workflows/` |

## Lecture transferts hors EEE

L’API Render de production et la base Supabase de production sont actuellement dans l’EEE. Le traitement Expo Push implique les États-Unis et doit rester couvert par les garanties contractuelles applicables. Les éventuels traitements support, sauvegarde, sécurité ou sous-traitants ultérieurs d’un fournisseur doivent être réévalués selon son DPA et sa liste de sous-traitants ; la seule région primaire ne suffit pas à conclure qu’aucun transfert secondaire n’existe.

## Non utilisés dans le backend actuel

Twilio, WhatsApp Cloud, SMTP/SendGrid, Firebase, publicité, analytics SDK.

Retour / suppression : résiliation service + workflow privacy pour les comptes. Les sauvegardes hébergeur suivent le délai du prestataire.
