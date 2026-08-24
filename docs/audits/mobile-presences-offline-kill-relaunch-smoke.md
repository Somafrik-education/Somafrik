# Smoke P0 — kill / relance / replay (Appel Enseignant hors connexion)

Date : 2026-08-24  
PR : #319 (Draft)  
Branche : `cursor/p0-mobile-presences-offline-a03f`

**Statut d'exécution dans cet environnement cloud : NON EXÉCUTÉ.**  
Pas d'émulateur Expo / appareil physique / Maestro kill-relaunch disponible ici.  
Le test unitaire « kill/relaunch » de `outbox.test.ts` conserve l'intention via un stockage injecté (mémoire ou fichier JSON Node). Ce n'est **pas** une fermeture réelle de l'application avec `expo-file-system`.

Ce protocole doit être joué **sur appareil ou émulateur** avant Ready. Tant qu'il n'est pas exécuté, #319 reste Draft.

---

## Contrat

```text
1. appareil / émulateur
2. roster chargé
3. couper Internet
4. Enregistrer
5. vérifier « En attente de synchronisation »
6. tuer complètement l'app
7. relancer offline
8. vérifier que l'intention existe toujours
9. remettre Internet
10. replay
11. 1 seul POST logique
12. PostgreSQL confirmé
13. UI → Enregistré
```

Aucun Ready. Aucun merge tant que ce smoke n'a pas été joué et consigné ci-dessous.

---

## Prérequis

- APK / client Expo de la HEAD de #319
- Compte enseignant avec au moins une classe et un élève
- Possibilité de couper le réseau (mode avion) **sans** tuer l'app
- Accès aux logs (Metro / `adb logcat`) pour compter les `POST /api/presences`
- Backend joignable pour le replay (étape 9+)

---

## Protocole manuel

1. Ouvrir **Présences**, choisir une classe, attendre le roster.
2. Passer l'appareil **hors connexion** (mode avion). Le bandeau **Hors connexion** doit apparaître.
3. Saisir un appel complet (ou **Tout présent**) puis **Enregistrer l'appel**.
4. Attendu immédiat :
   - alerte **Appel enregistré sur cet appareil — en attente de synchronisation**
   - lignes **En attente de synchronisation**
   - **pas** d'alerte « Appel synchronisé »
   - **aucun** `POST /api/presences`
5. Tuer l'application complètement (pas un simple passage en arrière-plan).
6. Relancer **toujours hors connexion**. Rouvrir le même appel.
7. Attendu :
   - l'intention est toujours là (lignes encore **En attente de synchronisation**, bandeau file non vide)
   - pas de retour à **Brouillon — non enregistré**
   - pas de **Enregistré** (PostgreSQL)
8. Rétablir Internet, laisser l'app au premier plan.
9. Attendu :
   - **un seul** `POST /api/presences` logique (même `Idempotency-Key` que l'intention persistée)
   - alerte **Appel synchronisé**
   - lignes **Enregistré**
10. Relancer une fois **en ligne** : pas de second POST pour la même intention.

---

## Résultat

| Étape | Attendu | Observé | Preuve |
| ----- | ------- | ------- | ------ |
| 4. Save offline | File persistée, copy « en attente » | *à renseigner* | capture / log |
| 7. Kill + relance offline | Intention toujours présente | *à renseigner* | capture |
| 9–10. Replay | 1 POST, PostgreSQL, UI Enregistré | *à renseigner* | log `POST /api/presences` |

- Exécuté par : *à renseigner*
- Appareil / OS : *à renseigner*
- HEAD : *SHA à coller après exécution*
- Verdict : **NON EXÉCUTÉ** (environnement cloud sans runtime Expo)

---

## Hors périmètre de ce document

- Automatisation Maestro du kill/relaunch (disproportionnée pour ce lot)
- Changement de schéma `attendance`
- Unicité quotidienne / last-write-wins (ATT-P1-008)
