# Registre des activités — sous-traitant (art. 30.2 RGPD)

**Sous-traitant :** Baudouin Okito — France — `contact@somafrik.app`  
**Pour le compte de :** établissements clients Somafrik (responsables)

| Traitement | Catégories | Finalité | Destinataires ultérieurs | Mesures |
|---|---|---|---|---|
| Hébergement API / Web | Comptes, données scolaires saisies | Fournir l’application | Render, Supabase | HTTPS, RBAC, deny plateforme, lockdown Data API |
| Notifications push | Jeton appareil, user/school ids | Envoyer les notifications demandées | Expo | Révocation à l’effacement / inactivité |
| Stockage PJ communications | Fichiers PDF/JPEG/PNG | Messages / annonces | Volume `SOMAFRIK_COMMUNICATION_STORAGE` | Magic bytes, pas d’URL anonyme |
| Audit | Actions, IP, UA | Sécurité et imputabilité | PostgreSQL `audit_logs` | Pas de secrets dans les valeurs |

Instructions du responsable : l’établissement configure les comptes et les habilitations. Somafrik n’utilise pas les données élèves pour du marketing.

Suppression : workflow `privacy_requests` — anonymisation du compte, conservation du dossier scolaire selon instruction / loi.
