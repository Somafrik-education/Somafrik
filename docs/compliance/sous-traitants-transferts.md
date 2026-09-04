# Sous-traitants et transferts

**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`  
**Date :** 2026-09-04  
Les régions exactes des data centers prestataires doivent être confirmées sur les contrats live (non copiés dans git).

| Prestataire | Finalité | Catégories | Lieu (à confirmer contrat) | Mécanisme | Durée / sortie |
|---|---|---|---|---|---|
| Supabase | PostgreSQL | Données métier | selon projet Supabase | DPA prestataire + SCC si hors EEE | révocation Data API ; dumps = politique backup |
| Render | API Node + site Web (canon `docs/render.md`) | Transit + logs hébergeur | selon service Render | DPA prestataire | fin de contrat / suppression service |
| Expo | Push Android + EAS build | jetons push, métadonnées app | infra Expo | DPA Expo | révocation token / rebuild |
| GitHub | CI | code, logs CI (pas de secrets métier) | GitHub | DPA GitHub | rétention logs CI |

**Non utilisés dans le backend actuel :** Twilio, WhatsApp Cloud, SMTP/SendGrid, Firebase, publicité, analytics SDK.

Anciens documents mentionnent Vercel pour le frontend ; la SoT hébergement Web+API est Render. À aligner ops si un DNS legacy subsiste.

Retour / suppression : résiliation service + workflow privacy pour les comptes. Les sauvegardes hébergeur suivent le délai du prestataire, documenté chez l’hébergeur, pas recopié ici.
