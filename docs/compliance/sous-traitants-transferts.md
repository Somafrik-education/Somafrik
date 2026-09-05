# Sous-traitants et transferts

**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`  
**Date de consignation :** 5 septembre 2026  
**Méthode :** régions **constatées** (DNS live, documentation prestataire publique) — plus de cellule « lieu à confirmer contrat ».

Les secrets (`DATABASE_URL`, clés) ne sont **pas** recopiés. Pour Supabase, la région AWS est le segment du hostname du pooler ; elle s’extrait sans mot de passe.

## Prestataires utilisés par l’application

| Prestataire | Finalité | Catégories | Lieu constaté | Mécanisme contractuel | Durée / sortie | Preuve |
|---|---|---|---|---|---|---|
| **Render** | API Node + site Web | Transit, journaux hébergeur, fichiers du volume PJ | **Oregon, USA** — origin `gcp-us-west1-1.origin.onrender.com` pour `api.somafrik.app`, `somafrik-api-preprod.onrender.com`, `preprod.somafrik.app` (CNAME 5 sept. 2026). Sites statiques : CDN Cloudflare en plus de l’origin Oregon. | [DPA GDPR Render](https://render.com/dpa) ; certification [EU-US Data Privacy Framework](https://www.dataprivacyframework.gov/) (Render, janv. 2025) ; sous-traitants AWS / GCP / Cloudflare / ClickHouse publiés sur [render.com/security](https://render.com/security) | fin de contrat / suppression du service Render | DNS CNAME `gcp-us-west1-1.origin.onrender.com` ; `docs/render.md` |
| **Supabase** | PostgreSQL | Données métier | **AWS**, hostname `aws-0-<région>.pooler.supabase.com` (modèle officiel). La région **live** est ce `<région>` (ex. `eu-central-1` = Francfort). Elle **n’est pas** dans git (l’exemple d’env utilise le marqueur `REGION` ; l’agent DEV n’a vu que `127.0.0.1`). Ops : extraire `new URL(DATABASE_URL).hostname` sur Render et coller **uniquement le hostname** ci-dessous. | [DPA Supabase](https://supabase.com/downloads/docs/Supabase+DPA+260317.pdf) (SCC modules processeur, UK Addendum) ; résidence primaire = région projet choisie au dashboard | révocation Data API ; dumps = politique backup prestataire | `.env.preproduction.example` (schéma d’hôte) ; extraction hostname live **à coller** : `_pooler hostname redacted — ops_` |
| **Expo** | Push Android + EAS | Jeton push, métadonnées d’appareil / build | **États-Unis, GCP** — documentation Expo : le service de push exige la connectivité vers GCP **United States** ([docs.expo.dev — sending notifications](https://docs.expo.dev/push-notifications/sending-notifications/)) | Conditions Expo : SCC module 2 (responsable → sous-traitant) pour les données d’usage du service ; [Trust / DPF](https://expo.dev/trust) ; DPA entreprise sur demande | révocation du jeton / rebuild | doc prestataire 5 sept. 2026 ; code `Mobile/` push devices |
| **GitHub** | CI / dépôt | Code, journaux CI (**pas** le dossier scolaire) | États-Unis + CDN (github.com) | [DPA GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-dpa) | rétention logs CI | `.github/workflows/` |

**Hostname Supabase live (à renseigner par ops, sans mot de passe) :**

```text
(non versé dans git au 2026-09-05 — coller aws-0-<région>.pooler.supabase.com)
```

## Non utilisés dans le backend actuel

Twilio, WhatsApp Cloud, SMTP/SendGrid, Firebase, publicité, analytics SDK.

Anciens documents mentionnent Vercel pour le frontend ; la SoT hébergement Web+API est **Render** (preuve DNS ci-dessus). À aligner ops si un DNS legacy subsiste.

Retour / suppression : résiliation service + workflow privacy pour les comptes. Les sauvegardes hébergeur suivent le délai du prestataire.
