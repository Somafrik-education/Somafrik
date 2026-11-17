# NFC-HERMES-CLOCK-01 — Horloge de la preuve native Hermes / SQLCipher

**Mandat :** CTO, priorité P1. **Base :** `develop@342e4a36`.

## Symptôme (RED Android)
Run [44056378791](https://github.com/Somafrik-education/Somafrik/actions/runs/44056378791), `develop@342e4a36`, `workflow_dispatch`. Le run #1175 [44056379418](https://github.com/Somafrik-education/Somafrik/actions/runs/44056379418) donne une sortie identique.

```
RC_NATIVE_PROOF S13 engine=hermes passed=27 total=27 failed=none
RC_NATIVE_PROOF cipher_version=4.7.0 community
RC_NATIVE_PROOF header=encrypted
RC_NATIVE_PROOF meta_persist=ok
RC_NATIVE_PROOF wrong_key=refused no_key=refused
RC_NATIVE_PROOF persist=ok scans=3 state=expired      ← attendu : state=draft
RC_NATIVE_PROOF pr3_persist=MISMATCH                  ← attendu : ok
RC_NATIVE_PROOF pr4_persist=ok
HERMES_S13_NOT_PROVEN / ANDROID_SQLCIPHER_NOT_PROVEN
```

Dernier succès : 2026-11-09, la date même des vecteurs. Le défaut ne dépend donc pas du code testé.

## Cause exacte
1. **Lancement 1.** Les preuves SQLCipher et PR3 créent leurs appels datés du `2026-11-09` :
   - la date est figée par les vecteurs PR0 ;
   - PR3 fixe aussi `nowMs = 2026-11-09T07:31:02Z`, mais **uniquement** dans son contexte de parcours.
2. **Lancements 1 et 2.** `createRollCallAccountManager(platform).activate()` exécute `runPurge(ctx)` avec `platform.nowMs = Date.now()`, l'horloge **réelle** de l'émulateur.
3. **Règle métier.** Sans pack, l'échéance locale d'un appel est la fin de J+3, soit `2026-11-13T12:00Z` (`openDraftSession`). Passé ce moment, `runPurge` passe la session à `expired` et efface le corps figé.
4. **Conséquence.** À partir du 13 novembre, le lancement 2 relit :
   - `state=expired` pour la preuve SQLCipher ;
   - un corps figé effacé pour PR3, d'où `pr3_persist=MISMATCH`.

   PR4 n'est pas touchée : elle date son appel du jour et utilise l'horloge réelle.

## Correctif (dispositif de test uniquement)
- `offlineRollCallProofHelpers.ts` (module de recette) gagne deux éléments :
  - `RC_PROOF_VECTOR_NOW_MS`, l'instant des vecteurs PR0 ;
  - `withProofClock(platform, nowMs)`, qui remplace **seulement** l'horloge de la plateforme de recette.
- `App.rcNativeProof.tsx` :
  - les managers SQLCipher et PR3 sont créés avec `withProofClock(platform, RC_PROOF_VECTOR_NOW_MS)`, aux deux lancements ;
  - l'horloge du contexte PR3 reprend la même constante ;
  - les `scannedAt` SQLCipher sont alignés sur cette horloge ;
  - **PR4 est inchangée** et garde l'horloge réelle, nécessaire à l'attente du backoff.
- **Non modifiés :** `runPurge`, `openDraftSession` (la règle J+3), les vecteurs, le workflow et ses déclencheurs.

## Tests
`Mobile/src/offline/rollCall/session/nativeProofClock.test.ts` : SQLite réel (`node:sqlite`), deux lancements, ajouté à `test:rollcall-offline`.

| Cas | Sur `develop` (`red-node.txt`) | Après correctif (`green-node.txt`) |
|---|---|---|
| CLOCK-01 RED : horloge réelle au lancement 2, état `expired` et corps purgé (reproduction du défaut) | ok | ok |
| CLOCK-01 GREEN : horloge contrôlée, `draft` et `closed` (corps conservé) après relancement | **échec** | ok |
| J+3 toujours appliquée avec l'horloge du contexte (`runPurge` inchangé) | ok | ok |
| Contrat de l'entrée de recette : SQLCipher et PR3 sous horloge contrôlée, PR4 sous horloge réelle | **échec** | ok |

**Non-régression :**
- `test:rollcall-offline` : 157 / 0 ;
- parité crypto (étape Node du workflow) : 12 / 0 ;
- NFC encoding, batch, security et diagnosis : OK ;
- `tsc` Mobile : 0 erreur ;
- `verify:mobile-security`, `verify:mobile-data-truth` : OK ;
- L4-09 : N/A.

**GREEN Android** (`pr3_persist=ok`, `persist=ok … state=draft`, `pr4_persist=ok`, S13 27/27, SQLCipher) : à relever sur le run Hermes de cette PR. Il ne peut pas être produit ici, faute de KVM dans le conteneur.
