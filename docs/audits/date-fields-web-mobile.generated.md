# Audit automatisé des dates Web / Mobile

> Généré par `scripts/audit-date-ui-contract.js`. Ne pas éditer manuellement.

- Fichiers candidats : **189** (Web 126, Mobile 63)
- Inputs calendrier natifs Web : **19**
- Violations du contrat UI détectées : **21**

## Inventaire

| Plateforme | Fichier | Termes date | Inputs date |
|---|---|---:|---:|
| Web | `web/src/components/communications/InternalNotificationsCenter.tsx` | 7 | 0 |
| Web | `web/src/components/demo/DemoRuntimeChrome.tsx` | 2 | 0 |
| Web | `web/src/components/grades/EvaluationFormModal.tsx` | 10 | 1 |
| Web | `web/src/components/grades/ParentChildGradesPanel.tsx` | 4 | 0 |
| Web | `web/src/components/grades/StudentGradesPanel.tsx` | 1 | 0 |
| Web | `web/src/components/marketing/MarketingFooter.tsx` | 1 | 0 |
| Web | `web/src/components/payments/OpenObligationCards.tsx` | 3 | 0 |
| Web | `web/src/components/payments/PaymentReceipt.tsx` | 3 | 0 |
| Web | `web/src/components/payments/QuickPaymentModal.tsx` | 6 | 1 |
| Web | `web/src/components/planning/CoursePlanningCalendar.tsx` | 12 | 0 |
| Web | `web/src/components/planning/PlanningMonthGrid.tsx` | 5 | 0 |
| Web | `web/src/components/planning/PlanningTimeGrid.tsx` | 13 | 0 |
| Web | `web/src/components/students/StudentCurrentEnrollmentCard.tsx` | 3 | 0 |
| Web | `web/src/components/students/StudentEnrollmentActions.tsx` | 7 | 2 |
| Web | `web/src/components/students/StudentEnrollmentHistory.tsx` | 1 | 0 |
| Web | `web/src/components/students/StudentIdentityTab.tsx` | 1 | 0 |
| Web | `web/src/components/students/StudentOverviewTab.tsx` | 2 | 0 |
| Web | `web/src/components/students/editing/StudentEditingPanel.tsx` | 2 | 0 |
| Web | `web/src/components/students/editing/StudentIdentityEditForm.tsx` | 7 | 1 |
| Web | `web/src/components/ui/DatePicker.tsx` | 7 | 1 |
| Web | `web/src/context/DataContext.tsx` | 4 | 0 |
| Web | `web/src/hooks/useStudentEditingContext.ts` | 2 | 0 |
| Web | `web/src/lib/academicPeriods.ts` | 88 | 0 |
| Web | `web/src/lib/academicYearsApi.ts` | 6 | 0 |
| Web | `web/src/lib/announcementsApi.ts` | 3 | 0 |
| Web | `web/src/lib/audit.ts` | 2 | 0 |
| Web | `web/src/lib/bulletinGrapesTemplate.ts` | 2 | 0 |
| Web | `web/src/lib/chartPeriod.ts` | 35 | 0 |
| Web | `web/src/lib/classStudentsApi.ts` | 3 | 0 |
| Web | `web/src/lib/classesApi.ts` | 2 | 0 |
| Web | `web/src/lib/contacts.ts` | 21 | 0 |
| Web | `web/src/lib/coursePlanning.ts` | 61 | 0 |
| Web | `web/src/lib/dashboardChartPeriod.ts` | 11 | 0 |
| Web | `web/src/lib/dashboardCharts.ts` | 1 | 0 |
| Web | `web/src/lib/demoRuntime.ts` | 6 | 0 |
| Web | `web/src/lib/entityModules.ts` | 32 | 0 |
| Web | `web/src/lib/evaluations.ts` | 38 | 0 |
| Web | `web/src/lib/examsApi.ts` | 1 | 0 |
| Web | `web/src/lib/fees.ts` | 18 | 0 |
| Web | `web/src/lib/financeApi.ts` | 5 | 0 |
| Web | `web/src/lib/financeCurrency.ts` | 2 | 0 |
| Web | `web/src/lib/financeIdempotency.ts` | 1 | 0 |
| Web | `web/src/lib/financePaymentWrite.ts` | 11 | 0 |
| Web | `web/src/lib/format.ts` | 4 | 0 |
| Web | `web/src/lib/internalNotificationsApi.ts` | 2 | 0 |
| Web | `web/src/lib/messagesApi.ts` | 5 | 0 |
| Web | `web/src/lib/pariteL3Pedagogy.red.ts` | 4 | 0 |
| Web | `web/src/lib/pedagogyParityContract.ts` | 2 | 0 |
| Web | `web/src/lib/pedagogySync.ts` | 1 | 0 |
| Web | `web/src/lib/planningCalendarUtils.ts` | 63 | 0 |
| Web | `web/src/lib/planningExamsSync.ts` | 2 | 0 |
| Web | `web/src/lib/presenceMetrics.ts` | 16 | 0 |
| Web | `web/src/lib/quickFeeGrid.ts` | 2 | 0 |
| Web | `web/src/lib/quickPayment.ts` | 17 | 0 |
| Web | `web/src/lib/rbacApi.ts` | 3 | 0 |
| Web | `web/src/lib/reportCardConfigurationApi.ts` | 1 | 0 |
| Web | `web/src/lib/schoolLogo.ts` | 1 | 0 |
| Web | `web/src/lib/schoolModule.ts` | 1 | 0 |
| Web | `web/src/lib/scope.ts` | 1 | 0 |
| Web | `web/src/lib/studentDocuments.ts` | 12 | 0 |
| Web | `web/src/lib/studentDomain.ts` | 35 | 0 |
| Web | `web/src/lib/studentDossierFromApi.ts` | 19 | 0 |
| Web | `web/src/lib/studentEditing.ts` | 18 | 0 |
| Web | `web/src/lib/studentEditingAdapters.ts` | 40 | 0 |
| Web | `web/src/lib/studentEditingChangeSet.ts` | 8 | 0 |
| Web | `web/src/lib/studentEditingCommands.ts` | 3 | 0 |
| Web | `web/src/lib/studentEditingRepository.mock.ts` | 24 | 0 |
| Web | `web/src/lib/studentEditingService.ts` | 19 | 0 |
| Web | `web/src/lib/studentEditingValidation.ts` | 29 | 0 |
| Web | `web/src/lib/studentEnrollment.ts` | 31 | 0 |
| Web | `web/src/lib/studentEnrollmentOverlay.ts` | 2 | 0 |
| Web | `web/src/lib/studentEnrollmentSelection.ts` | 4 | 0 |
| Web | `web/src/lib/studentEnrollmentViewModel.ts` | 1 | 0 |
| Web | `web/src/lib/studentGuardian.ts` | 18 | 0 |
| Web | `web/src/lib/studentHistory.ts` | 58 | 0 |
| Web | `web/src/lib/studentHistoryViewModel.ts` | 18 | 0 |
| Web | `web/src/lib/studentMedical.ts` | 6 | 0 |
| Web | `web/src/lib/studentMedicalViewModel.ts` | 1 | 0 |
| Web | `web/src/lib/studentWorkspaceAlerts.ts` | 6 | 0 |
| Web | `web/src/lib/studentWorkspaceDates.ts` | 25 | 0 |
| Web | `web/src/lib/studentWorkspaceOverview.ts` | 9 | 0 |
| Web | `web/src/lib/studentWorkspaceService.ts` | 1 | 0 |
| Web | `web/src/lib/studentWorkspaceViewModel.ts` | 4 | 0 |
| Web | `web/src/lib/studentsApi.ts` | 10 | 0 |
| Web | `web/src/lib/subscriptionModule.ts` | 42 | 0 |
| Web | `web/src/lib/syncOutbox.ts` | 16 | 0 |
| Web | `web/src/lib/teacherRules.ts` | 22 | 0 |
| Web | `web/src/lib/teachersApi.ts` | 3 | 0 |
| Web | `web/src/lib/unpaidModule.ts` | 32 | 0 |
| Web | `web/src/lib/userAccountRules.ts` | 1 | 0 |
| Web | `web/src/lib/userAccounts.ts` | 1 | 0 |
| Web | `web/src/lib/userTeacherSync.ts` | 7 | 0 |
| Web | `web/src/pages/AnnouncementsPage.tsx` | 12 | 0 |
| Web | `web/src/pages/ConfigurationPage.tsx` | 34 | 2 |
| Web | `web/src/pages/CountriesPage.tsx` | 4 | 0 |
| Web | `web/src/pages/CoursePlanningPage.tsx` | 6 | 0 |
| Web | `web/src/pages/EntityPage.tsx` | 6 | 0 |
| Web | `web/src/pages/GradesEvaluationsPage.tsx` | 3 | 0 |
| Web | `web/src/pages/MessagesConversationsPage.tsx` | 7 | 0 |
| Web | `web/src/pages/PermissionsPage.tsx` | 9 | 0 |
| Web | `web/src/pages/PlatformNotificationsPage.tsx` | 4 | 0 |
| Web | `web/src/pages/PresencesPage.tsx` | 5 | 0 |
| Web | `web/src/pages/ReportCardHistoryPage.tsx` | 2 | 0 |
| Web | `web/src/pages/SchoolsPage.tsx` | 8 | 0 |
| Web | `web/src/pages/SubscriptionsPage.tsx` | 6 | 0 |
| Web | `web/src/pages/UsersPage.tsx` | 2 | 0 |
| Web | `web/src/pages/abonnements/MonAbonnementPage.tsx` | 2 | 0 |
| Web | `web/src/pages/abonnements/MonAbonnementPaymentsPage.tsx` | 2 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionDelinquencyPage.tsx` | 1 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionDiscountsPage.tsx` | 3 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionInvoicesPage.tsx` | 1 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionOffersPage.tsx` | 6 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionPaymentsPage.tsx` | 2 | 0 |
| Web | `web/src/pages/abonnements/SubscriptionSchoolsPage.tsx` | 5 | 0 |
| Web | `web/src/pages/abonnements/TrialRequestsPage.tsx` | 1 | 0 |
| Web | `web/src/pages/entity-page/entityColumns.tsx` | 3 | 0 |
| Web | `web/src/pages/entity-page/entityCrudCore.ts` | 1 | 0 |
| Web | `web/src/pages/etablissement/ClassStudentsPage.tsx` | 10 | 1 |
| Web | `web/src/pages/etablissement/TeachersListPage.tsx` | 17 | 2 |
| Web | `web/src/pages/finances/FinanceFeesPage.tsx` | 15 | 1 |
| Web | `web/src/pages/finances/FinanceUnpaidPage.tsx` | 3 | 0 |
| Web | `web/src/pages/parametres/DataBackupSettingsPage.tsx` | 2 | 0 |
| Web | `web/src/pages/parametres/EstablishmentProfilePage.tsx` | 1 | 0 |
| Web | `web/src/pages/parametres/SecuritySettingsPage.tsx` | 7 | 0 |
| Web | `web/src/pages/planning/PlanningSubstitutionsPage.tsx` | 16 | 2 |
| Web | `web/src/types.ts` | 30 | 0 |
| Mobile | `Mobile/src/components/AnnouncementMutationControls.tsx` | 2 | 0 |
| Mobile | `Mobile/src/components/FormField.tsx` | 1 | 0 |
| Mobile | `Mobile/src/components/PaymentMutationControls.tsx` | 3 | 0 |
| Mobile | `Mobile/src/components/PaymentReceiptCard.tsx` | 3 | 0 |
| Mobile | `Mobile/src/components/StudentMutationControls.tsx` | 4 | 0 |
| Mobile | `Mobile/src/components/TeacherMutationControls.tsx` | 15 | 1 |
| Mobile | `Mobile/src/context/AdminDataContext.tsx` | 4 | 0 |
| Mobile | `Mobile/src/data/catalog.ts` | 89 | 0 |
| Mobile | `Mobile/src/domain/academics/GradeBookService.ts` | 15 | 0 |
| Mobile | `Mobile/src/domain/communication/MessageService.ts` | 19 | 0 |
| Mobile | `Mobile/src/lib/academicPeriods.ts` | 40 | 0 |
| Mobile | `Mobile/src/lib/attendanceDraft.ts` | 3 | 0 |
| Mobile | `Mobile/src/lib/attendanceOffline.ts` | 2 | 0 |
| Mobile | `Mobile/src/lib/attendanceTruth.ts` | 16 | 0 |
| Mobile | `Mobile/src/lib/canonicalResourceNormalize.ts` | 31 | 0 |
| Mobile | `Mobile/src/lib/classTodayPresenceBadge.ts` | 6 | 0 |
| Mobile | `Mobile/src/lib/communicationPagination.ts` | 11 | 0 |
| Mobile | `Mobile/src/lib/coursePlanning.ts` | 15 | 0 |
| Mobile | `Mobile/src/lib/dataTruth.ts` | 10 | 0 |
| Mobile | `Mobile/src/lib/evaluationsV2.ts` | 15 | 0 |
| Mobile | `Mobile/src/lib/financeCurrency.ts` | 2 | 0 |
| Mobile | `Mobile/src/lib/formFieldTokens.ts` | 1 | 0 |
| Mobile | `Mobile/src/lib/formFieldValidation.ts` | 13 | 0 |
| Mobile | `Mobile/src/lib/format.ts` | 9 | 0 |
| Mobile | `Mobile/src/lib/offlinePermissionsSnapshot.ts` | 2 | 0 |
| Mobile | `Mobile/src/lib/outbox.ts` | 3 | 0 |
| Mobile | `Mobile/src/lib/paymentEnrollment.ts` | 13 | 0 |
| Mobile | `Mobile/src/lib/pedagogyParityContract.ts` | 2 | 0 |
| Mobile | `Mobile/src/lib/planningV2.ts` | 3 | 0 |
| Mobile | `Mobile/src/lib/progressiveDisclosureUxContract.ts` | 2 | 0 |
| Mobile | `Mobile/src/lib/schoolAcademicPeriods.ts` | 84 | 0 |
| Mobile | `Mobile/src/lib/schoolLogo.ts` | 1 | 0 |
| Mobile | `Mobile/src/lib/scope.ts` | 1 | 0 |
| Mobile | `Mobile/src/lib/todayPresenceKpi.ts` | 8 | 0 |
| Mobile | `Mobile/src/lib/unpaidLedger.ts` | 3 | 0 |
| Mobile | `Mobile/src/lib/userTeacherSync.ts` | 1 | 0 |
| Mobile | `Mobile/src/models/Note.ts` | 1 | 0 |
| Mobile | `Mobile/src/models/Paiement.ts` | 1 | 0 |
| Mobile | `Mobile/src/models/Presence.ts` | 1 | 0 |
| Mobile | `Mobile/src/offline/l1/database.ts` | 1 | 0 |
| Mobile | `Mobile/src/offline/l1/migrations.ts` | 1 | 0 |
| Mobile | `Mobile/src/offline/l1/repository.ts` | 2 | 0 |
| Mobile | `Mobile/src/offline/l1/schema.ts` | 1 | 0 |
| Mobile | `Mobile/src/offline/l1/uiProjection.ts` | 1 | 0 |
| Mobile | `Mobile/src/screens/AdminCrudScreen.tsx` | 121 | 0 |
| Mobile | `Mobile/src/screens/AnnouncementsScreen.tsx` | 14 | 0 |
| Mobile | `Mobile/src/screens/HomeScreen.tsx` | 5 | 0 |
| Mobile | `Mobile/src/screens/InternalNotificationsScreen.tsx` | 7 | 0 |
| Mobile | `Mobile/src/screens/MessagesScreen.tsx` | 4 | 0 |
| Mobile | `Mobile/src/screens/PlatformNotificationsScreen.tsx` | 4 | 0 |
| Mobile | `Mobile/src/screens/ReportCardsScreen.tsx` | 3 | 0 |
| Mobile | `Mobile/src/screens/SchoolYearSettingsScreen.tsx` | 33 | 2 |
| Mobile | `Mobile/src/screens/StudentPaymentsScreen.tsx` | 4 | 0 |
| Mobile | `Mobile/src/screens/StudentPresencesScreen.tsx` | 1 | 0 |
| Mobile | `Mobile/src/screens/StudentsScreen.tsx` | 2 | 0 |
| Mobile | `Mobile/src/screens/TeacherAttendanceScreen.tsx` | 15 | 0 |
| Mobile | `Mobile/src/screens/TeacherGradesScreen.tsx` | 15 | 1 |
| Mobile | `Mobile/src/screens/TimetableScreen.tsx` | 7 | 1 |
| Mobile | `Mobile/src/screens/UnpaidScreen.tsx` | 1 | 0 |
| Mobile | `Mobile/src/services/api.ts` | 9 | 0 |
| Mobile | `Mobile/src/services/domainHydrationApi.ts` | 3 | 0 |
| Mobile | `Mobile/src/services/internalNotificationsApi.ts` | 2 | 0 |
| Mobile | `Mobile/src/services/schoolSettingsApi.ts` | 6 | 0 |

## Inputs calendrier détectés

| Plateforme | Fichier | Nombre |
|---|---|---:|
| Web | `web/src/components/grades/EvaluationFormModal.tsx` | 1 |
| Web | `web/src/components/payments/QuickPaymentModal.tsx` | 1 |
| Web | `web/src/components/students/StudentEnrollmentActions.tsx` | 2 |
| Web | `web/src/components/students/editing/StudentIdentityEditForm.tsx` | 1 |
| Web | `web/src/components/ui/DatePicker.tsx` | 1 |
| Web | `web/src/pages/ConfigurationPage.tsx` | 2 |
| Web | `web/src/pages/etablissement/ClassStudentsPage.tsx` | 1 |
| Web | `web/src/pages/etablissement/TeachersListPage.tsx` | 2 |
| Web | `web/src/pages/finances/FinanceFeesPage.tsx` | 1 |
| Web | `web/src/pages/planning/PlanningSubstitutionsPage.tsx` | 2 |
| Mobile | `Mobile/src/components/TeacherMutationControls.tsx` | 1 |
| Mobile | `Mobile/src/screens/SchoolYearSettingsScreen.tsx` | 2 |
| Mobile | `Mobile/src/screens/TeacherGradesScreen.tsx` | 1 |
| Mobile | `Mobile/src/screens/TimetableScreen.tsx` | 1 |

## Violations D1 / D5 / D7

| Code | Plateforme | Fichier | Ligne | Correction |
|---|---|---|---:|---|
| D7_DIRECT_INTL | Web | `web/src/components/communications/InternalNotificationsCenter.tsx` | 25 | Centraliser dans dates.ts. |
| D1_BAD_PLACEHOLDER | Web | `web/src/components/ui/DatePicker.tsx` | 14 | Le contrat UI est JJ-MM-AAAA. |
| D1_BAD_PLACEHOLDER | Web | `web/src/components/ui/DatePicker.tsx` | 16 | Le contrat UI est JJ-MM-AAAA. |
| D1_BAD_PLACEHOLDER | Web | `web/src/components/ui/DatePicker.tsx` | 71 | Le contrat UI est JJ-MM-AAAA. |
| D7_DIRECT_INTL | Web | `web/src/pages/AnnouncementsPage.tsx` | 63 | Centraliser dans dates.ts. |
| D7_DIRECT_LOCALE | Web | `web/src/pages/CountriesPage.tsx` | 177 | Utiliser formatDateForDisplay(). |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/EntityPage.tsx` | 630 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/EntityPage.tsx` | 636 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D7_DIRECT_INTL | Web | `web/src/pages/MessagesConversationsPage.tsx` | 37 | Centraliser dans dates.ts. |
| D7_DIRECT_LOCALE | Web | `web/src/pages/PlatformNotificationsPage.tsx` | 79 | Utiliser formatDateForDisplay(). |
| D7_DIRECT_LOCALE | Web | `web/src/pages/SubscriptionsPage.tsx` | 44 | Utiliser formatDateForDisplay(). |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/UsersPage.tsx` | 450 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D7_DIRECT_LOCALE | Web | `web/src/pages/abonnements/SubscriptionSchoolsPage.tsx` | 105 | Utiliser formatDateForDisplay(). |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/etablissement/TeachersListPage.tsx` | 70 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/parametres/DataBackupSettingsPage.tsx` | 102 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D5_RAW_ISO_SLICE | Web | `web/src/pages/parametres/SecuritySettingsPage.tsx` | 160 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D5_RAW_ISO_SLICE | Mobile | `Mobile/src/components/PaymentMutationControls.tsx` | 33 | Vérifier qu'il ne s'agit pas d'un formatage UI ISO. |
| D7_DIRECT_LOCALE | Mobile | `Mobile/src/screens/AdminCrudScreen.tsx` | 2627 | Utiliser formatDateForDisplay(). |
| D7_DIRECT_INTL | Mobile | `Mobile/src/screens/AnnouncementsScreen.tsx` | 47 | Centraliser dans dates.ts. |
| D7_DIRECT_INTL | Mobile | `Mobile/src/screens/InternalNotificationsScreen.tsx` | 47 | Centraliser dans dates.ts. |
| D7_DIRECT_LOCALE | Mobile | `Mobile/src/screens/PlatformNotificationsScreen.tsx` | 112 | Utiliser formatDateForDisplay(). |

## Contrat cible

- UI : `JJ-MM-AAAA`.
- Date civile API/DB : `YYYY-MM-DD`.
- Horodatage technique : ISO 8601.
- Aucun parsing UTC implicite pour transformer une date civile.
