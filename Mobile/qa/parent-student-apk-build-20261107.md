# Somafrik — APK préproduction Parent/Élève

Build de recette, sans changement de code produit.

- Base: `develop@cf5bd480c22eaf5b20c748fefca0fb004c7a4132`
- Comprend les merges #1115 (défilement Notes et Présences) et #1116 (login Élève mot de passe).
- Workflow: `NFC encoding preproduction evidence` → `NFC APK preview exact HEAD`, profil `preview`, API `https://api-preprod.somafrik.app`.
- Signature de test uniquement ; **ne pas publier dans Play Store**.
- Validation attendue: install Android, Parent 1/3 enfants, Notes, Présences, scroll, Élève reset Web + login, cloisonnement.

Ce fichier documentaire ne doit pas être mergé ; la PR sert uniquement à générer l'artefact APK depuis le code validé.
