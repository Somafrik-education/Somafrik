# Registre des captures métier réelles

Ce registre est la gate d'intégrité visuelle des guides utilisateurs.

**Règle :** une ligne passe à `VALIDÉE` uniquement après capture d'une instance Somafrik réellement exécutée sur le SHA documenté (ou sur un SHA ultérieur explicitement revalidé). Les données affichées doivent être fictives.

Statuts :

- `À CAPTURER` : composant réel vérifié, image runtime non encore produite ;
- `À REVALIDER` : image disponible mais version/état à vérifier ;
- `VALIDÉE` : image runtime vérifiée et intégrable ;
- `RETIRÉE` : écran obsolète ou non canonique.

## Web

| # | Capture cible | Écran / état métier | Rôle de référence | Source réelle `develop` | Statut |
|---|---|---|---|---|---|
| W01 | `assets/web/01-connexion-etablissement.png` | Connexion, profil Établissement, champs vides | Admin établissement | `web/src/pages/LoginPage.tsx` | VALIDÉE |
| W02 | `assets/web/02-tableau-de-bord-etablissement.png` | Tableau de bord après connexion | Admin établissement | route `/tableau-de-bord` dans `web/src/App.tsx` | VALIDÉE |
| W03 | `assets/web/03-classes-liste.png` | Liste avec plusieurs classes et statuts | Admin établissement | `web/src/pages/etablissement/ClassesListPage.tsx` | VALIDÉE |
| W04 | `assets/web/04-classe-ajout.png` | Modal Ajouter une classe | Admin établissement | `ClassesListPage.tsx` | VALIDÉE |
| W05 | `assets/web/05-eleves-annuaire.png` | Annuaire avec bouton Dossier, sans création globale | Secrétaire/Admin | `web/src/pages/etablissement/StudentsListPage.tsx` | VALIDÉE |
| W06 | `assets/web/06-eleve-dossier.png` | Dossier d'un élève fictif | Admin établissement | `StudentWorkspacePage` via `web/src/App.tsx` | VALIDÉE |
| W07 | `assets/web/07-enseignants-liste.png` | Liste, Modifier/Affecter selon droits | Admin établissement | `web/src/pages/etablissement/TeachersListPage.tsx` | À CAPTURER |
| W08 | `assets/web/08-enseignant-affectation.png` | Modal Affecter un cours | Admin établissement | `TeachersListPage.tsx` | À CAPTURER |
| W09 | `assets/web/09-utilisateurs-liste.png` | Comptes et rôles actifs | Admin établissement | `web/src/pages/UsersPage.tsx` | À CAPTURER |
| W10 | `assets/web/10-utilisateur-roles.png` | Attribution/retrait de rôles | Admin habilité | `web/src/pages/UsersPage.tsx` | À CAPTURER |
| W11 | `assets/web/11-presences-classes.png` | Sélection de classe pour l'appel | Enseignant/Préfet | `web/src/pages/PresencesPage.tsx` | À CAPTURER |
| W12 | `assets/web/12-presences-appel.png` | Appel avec Présent/Absent/Retard/Justifié | Enseignant/Préfet | `PresencesPage.tsx` | À CAPTURER |
| W13 | `assets/web/13-evaluations.png` | Onglet Évaluations | Enseignant/Préfet | `web/src/pages/GradesEvaluationsPage.tsx` | À CAPTURER |
| W14 | `assets/web/14-saisie-notes.png` | Onglet Saisie des notes | Enseignant | `GradesEvaluationsPage.tsx` | À CAPTURER |
| W15 | `assets/web/15-paiements.png` | Liste des paiements | Comptable/Admin | route `/finances/paiements` (`EntityPage`) | À CAPTURER |
| W16 | `assets/web/16-paiement-saisie.png` | Formulaire de paiement réel | Comptable/Admin | composant paiement utilisé par `EntityPage` | À CAPTURER |

## Mobile

| # | Capture cible | Écran / état métier | Rôle de référence | Source réelle `develop` | Statut |
|---|---|---|---|---|---|
| M01 | `assets/mobile/01-connexion-etablissement.png` | Identifiant + rôle détecté + secret | Utilisateur établissement | `Mobile/src/screens/LoginScreen.tsx` | À CAPTURER |
| M02 | `assets/mobile/02-classes-liste.png` | Classes actives, élèves inscrits, cartes | Admin établissement | `Mobile/src/screens/ClassesScreen.tsx` | À CAPTURER |
| M03 | `assets/mobile/03-classe-creation.png` | Modal Créer une classe | Admin établissement | `Mobile/src/components/ClassMutationControls.tsx` | À CAPTURER |
| M04 | `assets/mobile/04-eleves-liste.png` | Liste compacte avec recherche | Admin/Secrétaire | `Mobile/src/screens/StudentsScreen.tsx` | À CAPTURER |
| M05 | `assets/mobile/05-eleve-inscription.png` | Modal Inscrire un élève | Admin/Secrétaire habilité | `Mobile/src/components/StudentMutationControls.tsx` | À CAPTURER |
| M06 | `assets/mobile/06-eleve-identifiants.png` | Remettre les identifiants élève | Même session que M05 | `StudentMutationControls.tsx` + `SecretHandoffModal` | À CAPTURER |
| M07 | `assets/mobile/07-enseignants.png` | Liste enseignants | Admin établissement | `Mobile/src/screens/TeachersScreen.tsx` | À CAPTURER |
| M08 | `assets/mobile/08-enseignant-creation.png` | Créer un enseignant | Admin habilité | `Mobile/src/components/TeacherMutationControls.tsx` | À CAPTURER |
| M09 | `assets/mobile/09-utilisateurs.png` | Cartes comptes, rôles actifs | Admin établissement | `Mobile/src/screens/UsersScreen.tsx` | À CAPTURER |
| M10 | `assets/mobile/10-utilisateur-creation.png` | Créer un utilisateur | Admin habilité | `Mobile/src/components/UserMutationControls.tsx` | À CAPTURER |
| M11 | `assets/mobile/11-utilisateur-role-enseignant.png` | Confirmation Attribuer Enseignant | Admin habilité | `UserMutationControls.tsx` | À CAPTURER |
| M12 | `assets/mobile/12-paiements.png` | Synthèse + reçus récents | Comptable/Admin | `Mobile/src/screens/PaymentsScreen.tsx` | À CAPTURER |
| M13 | `assets/mobile/13-paiement-saisie.png` | Élève + Classe + Montant + Type de frais + Moyen | Comptable/Admin | `Mobile/src/components/PaymentMutationControls.tsx` | À CAPTURER |
| M14 | `assets/mobile/14-paiement-recu.png` | Reçu après confirmation et refresh | Comptable/Admin | `PaymentsScreen.tsx` + `PaymentReceiptCard` | À CAPTURER |
| M15 | `assets/mobile/15-presences-classes.png` | Mes classes | Enseignant | `Mobile/src/screens/TeacherAttendanceScreen.tsx` | À CAPTURER |
| M16 | `assets/mobile/16-presences-appel.png` | Appel complet | Enseignant | `TeacherAttendanceScreen.tsx` | À CAPTURER |
| M17 | `assets/mobile/17-evaluations.png` | Liste évaluations | Enseignant | `Mobile/src/screens/TeacherGradesScreen.tsx` | À CAPTURER |
| M18 | `assets/mobile/18-evaluation-creation.png` | Nouvelle évaluation | Enseignant habilité | `TeacherGradesScreen.tsx` | À CAPTURER |
| M19 | `assets/mobile/19-notes-saisie.png` | Roster + saisie notes | Enseignant | `TeacherGradesScreen.tsx` | À CAPTURER |
| M20 | `assets/mobile/20-parent-accueil.png` | Onglets Profil/Notes/Présence/Frais | Parent | `Mobile/src/navigation/roleTabPreferences.ts` + écrans Student* | À CAPTURER |
| M21 | `assets/mobile/21-eleve-accueil.png` | Onglets Profil/Notes/Présence/Frais | Élève | `roleTabPreferences.ts` + écrans Student* | À CAPTURER |
| M22 | `assets/mobile/22-menu-admin-etablissement.png` | Menu filtré avec Paramètres/Structure selon droits | Admin établissement | `Mobile/src/navigation/roleDrawerPreferences.ts` | À CAPTURER |
| M23 | `assets/mobile/23-synchronisation-attente.png` | Mutation en attente, sans faux succès | Rôle autorisé | `Mobile/src/lib/outbox.ts` + écrans métier | À CAPTURER |

## Jeu de données fictif recommandé

Pour maintenir la cohérence entre les images :

- établissement : **Institut Nouvelle Espérance** ;
- classes : **6e A**, **5e B**, **1ère Scientifique** uniquement si le référentiel runtime le permet réellement ;
- élèves : **Esther Okito**, **Jean Mukendi**, **Amina Ilunga** ;
- enseignants : **Amina Kabila**, **Patrick Ilunga** ;
- montants et paiements : valeurs fictives en FC ;
- numéros : plages fictives, jamais de téléphone réel ;
- e-mails : domaines de démonstration/non routables.

Le nom d'une classe doit toujours provenir du référentiel réellement chargé dans l'instance utilisée pour la capture. Ne pas forcer un libellé pour obtenir une image plus esthétique.

## Contrôles avant validation d'une capture

1. le SHA/runtime est identifié ;
2. aucun écran BackOffice legacy ;
3. aucune donnée personnelle réelle ;
4. le rôle de test correspond à la ligne du registre ;
5. les boutons visibles correspondent au RBAC réel ;
6. aucune DevTools, token, URL sensible ou secret dans l'image ;
7. les données affichées ont été rechargées depuis le backend ;
8. la capture n'est pas une maquette ni une reconstruction graphique ;
9. le fichier est enregistré au chemin prévu ;
10. le statut passe à `VALIDÉE` dans la même PR que l'image.
