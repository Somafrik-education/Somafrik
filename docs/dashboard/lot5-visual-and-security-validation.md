# Dashboard Web — LOT 5 : validation finale (issue #805)

## Référence visuelle
Maquette Somafrik `tableau-de-bord-web.png`, Library `/Somafrik/Maquettes/`, version du 24 septembre 2026. La maquette a été inspectée indépendamment ; elle n'est **pas** une capture de l'application exécutée. La comparaison pixel à pixel reste impossible tant qu'une capture de la branche en navigateur n'est pas produite.

## Contrat livré par les LOTS 1–4
| Zone | Référence | Code existant | Statut |
| --- | --- | --- | --- |
| En-tête | Tableau de bord + année scolaire + date | Titre et date du jour ; année « Non sélectionnée » non interactive | PARTIEL — filtres historiques hors contrat validé |
| KPI | Élèves, enseignants, classes, recettes | 4 cartes avec RBAC ; recettes mono-devise seulement | PARTIEL — tendances mensuelles non implémentées |
| Graphique central | Un graphique + choix d'indicateur | Sélecteur instantané des graphiques autorisés, périodes par graphique | À VALIDER VISUELLEMENT |
| Activités récentes | Flux en temps réel, types métier variés | Flux paginé/polling 30 s, uniquement admin établissement, 3 actions autorisées | PARTIEL — événements paiements, présences, notes et enseignants non encore alimentés |
| Répartition | Anneau par niveau + effectifs | Anneau avec données scoped, légende et effectifs | À VALIDER VISUELLEMENT |
| Présence | Anneau + répartition par statut | Taux du jour + barre, « — » si appel incomplet | PARTIEL — présentation différente de la maquette |
| Responsive Web | Cartes adaptatives | Grilles 1/2/4 colonnes selon largeur ; panneaux secondaires 1/2 colonnes | À VALIDER SUR APPAREILS |
| Barre latérale/topbar | Navigation existante | Hors périmètre #805 | INCHANGÉ |

**Ne pas présenter les chiffres illustratifs de la maquette comme des données réelles.**

## Tests automatisés ajoutés dans LOT 5
- Backend : 403 pour rôles plateforme/staff/parent ; identité tenant absente/invalide ; SQL filtré par UUID + liste blanche ; projection sans payload sensible ; pagination stable et curseur invalide.
- Web : sélection du graphique central sans navigation ; retrait immédiat des options révoquées lors d'un changement de permissions.
- Web : aucune requête activités pour rôle non autorisé ; réponse démo invalide gérée ; ancienne requête ignorée après changement d'établissement.
- Web : widgets secondaires cachés sans permission ; pas de taux sur appel partiel ; taux accessible si appel complet.

## Smoke navigateur à effectuer avant GO visuel
1. Compte admin école A, 2 classes, 2 niveaux, élèves et appels partiels : taux « — », répartition A uniquement.
2. Compléter tous les appels du jour : taux calculé ; retards inclus, justifiés exclus.
3. Basculer vers école B : aucun élève, classe ou activité de A ; vérifier aussi une requête lente pendant le basculement.
4. Compte sans Présences:READ : aucune carte présence. Compte sans Élèves:READ : aucune répartition par niveau. Compte sans droits graphiques : message vide.
5. Changer le graphique central, la période, puis le rôle : pas de graphique interdit ni rechargement complet.
6. Activités : vérifier 403 enseignant/secrétaire/parent/plateforme, pagination, rafraîchissement 30 s en onglet visible et arrêt du polling au démontage.
7. Capturer les largeurs 375 px, 768 px, 1280 px et comparer avec la maquette ; vérifier débordement, lisibilité, navigation clavier, zoom 200 %.

## Gouvernance
Cette PR contient des tests et ce constat d'écart, pas de refonte non validée. CI complète, smoke visuel et **diff GitHub indépendant** obligatoires avant Ready/Merge. Cible : `develop` exclusivement ; aucun changement `main` ni déploiement.
