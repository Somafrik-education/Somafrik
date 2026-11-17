# E2E-PREPROD-GLOBAL-01 — Anomalies P0 à P3

**Constat préalable : 124 des 125 scénarios E2E sont BLOCKED.** L'absence d'anomalie confirmée en préproduction ne signifie **pas** l'absence d'anomalie : elle reflète une couverture E2E quasi nulle.

## Anomalies confirmées par un E2E préprod

Aucune. Le seul scénario exécuté (E2E-009, 334 routes protégées interrogées sans jeton) est PASS.

## Risques et anomalies ouverts, d'autres sources

| ID | Gravité | Source | Description | Statut | Ticket |
|---|---|---|---|---|---|
| R-01 | **P1** (sécurité / intégrité) | [Code] + [Auto] PG 16, caractérisations C03 et C06 | PostgreSQL accepte des affectations et des inscriptions pointant vers la classe ou la matière d'un autre établissement. Seule la couche applicative protège | **Ouvert**. Audit des données de préproduction BLOCKED (BLK-PG) | [#1178](https://github.com/Somafrik-education/Somafrik/issues/1178) |
| R-02 | P2, **à vérifier** | [Code] | Si `SOMAFRIK_E2E=true` en préproduction, `POST /api/backoffice/e2e/clear-login-lockout` est public : n'importe qui peut lever les verrous de connexion, ce qui aide la force brute. En production, la garde de démarrage l'empêche ; en préproduction, rien | **Non vérifié** (BLK-RENDER) ; pas d'appel direct, car destructif si la route est active | À ouvrir si la variable est active |
| R-03 | P3 | [E2E préprod] | Le build Web n'expose aucun SHA, donc on ne peut pas rattacher exactement une recette Web à un commit (seule l'empreinte du bundle est disponible) | Ouvert | Proposition (`RESULTATS-WEB.md`) |
| R-04 | P2 (connu) | [Code], audit 10 étapes | Lecture `approved` des inscriptions dans la liste des élèves de classe (`classStudentsRepository`), alors qu'aucun code n'écrit ce statut | Ouvert, sans impact connu | `AUDIT-SETUP-GUIDED-10-01` §11 |

**Aucun P0 constaté.** Un P1 reste ouvert (R-01, #1178) : il interdit une recommandation GO tant qu'il n'est pas traité ou explicitement accepté par le CTO.
