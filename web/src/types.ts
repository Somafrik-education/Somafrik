// Types métier alignés sur l'API Express/PostgreSQL de Somafrik.

import type { DashboardChartConfig } from "./lib/chartTypes";
import type {
  Guardian,
  Person,
  Student,
  StudentDocument,
  StudentEnrollment,
  StudentGuardianRelation,
  StudentMedicalProfile,
} from "./lib/studentDomain";

export type {
  Guardian,
  Person,
  Student,
  StudentDocument,
  StudentEnrollment,
  StudentGuardianRelation,
  StudentMedicalProfile,
} from "./lib/studentDomain";

export type { DashboardChartConfig };

export interface School {
  id?: string;
  publicId?: string;
  code: string;
  name: string;
  type?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
  status?: string;
  validationStatus?: string;
  validationRequestedBy?: string;
  validationRequestedAt?: string;
  validatedBy?: string | null;
  validatedAt?: string | null;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  subscriptionEndDate?: string;
  maxStudents?: number;
  maxTeachers?: number;
  logoUrl?: string;
  schoolCode?: string;
  /** Directeur / recteur / responsable principal (ETB-F01). */
  principalName?: string;
  principalEmail?: string;
  principalPhone?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Country {
  id?: string;
  name: string;
  code: string;
  phonePrefix?: string;
  currency?: string;
  timezone?: string;
  status?: string;
  administratorId?: string;
  createdAt?: string;
  /** Barème d'abonnement propre au pays (repli sur le barème global Somafrik). */
  subscriptionPolicy?: CountrySubscriptionPolicy;
  /** Libellés UI du référentiel pédagogique (configurables, jamais un défaut RDC). */
  levelLabel?: string;
  trackLabel?: string;
  groupLabel?: string;
}

export type SubscriptionPlanName = "Essentiel" | "Standard" | "Premium" | "Essai gratuit";

export interface SubscriptionPlanPricing {
  monthlyPrice: number;
  annualPrice: number;
}

export interface CountrySubscriptionPolicy {
  currency?: string;
  plans: Record<SubscriptionPlanName, SubscriptionPlanPricing>;
}

/** Statut du cycle de vie d'un abonnement établissement. */
export type SubscriptionLifecycleStatus =
  | "Brouillon"
  | "Essai"
  | "Actif"
  | "En retard"
  | "Suspendu"
  | "Expiré"
  | "Résilié"
  | "Annulé";

export type SubscriptionBillingCycle = "monthly" | "quarterly" | "annual";

export type SubscriptionAccessLevel = "full" | "limited" | "readonly" | "blocked";

/** Plan commercial Somafrik (offre d'abonnement). */
export interface SubscriptionOffer {
  id: string;
  name: string;
  targetAudience?: string;
  monthlyPrice: number;
  quarterlyPrice?: number;
  annualPrice?: number;
  currency: string;
  maxStudents?: number | null;
  maxTeachers?: number | null;
  maxUsers?: number | null;
  storageGb?: number;
  /** Modules inclus : true = oui, false = non, "limited" = limité. */
  modules: Record<string, boolean | "limited">;
  trialDays?: number;
  active: boolean;
  /** Codes pays ISO (vide = tous les pays). */
  countryCodes?: string[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Subscription {
  id?: string;
  schoolCode: string;
  countryCode?: string;
  country?: string;
  /** Référence offre commerciale. */
  offerId?: string;
  plan?: string;
  monthlyPrice?: number;
  annualPrice?: number;
  currency?: string;
  /** Statut legacy affiché (Actif / Suspendu). */
  status?: string;
  /** Statut cycle de vie complet. */
  lifecycleStatus?: SubscriptionLifecycleStatus;
  paymentStatus?: string;
  billingCycle?: SubscriptionBillingCycle;
  paymentMethod?: string;
  startDate?: string;
  endDate?: string;
  nextRenewalDate?: string;
  lastPaymentDate?: string;
  maxStudents?: number | null;
  maxTeachers?: number | null;
  maxUsers?: number | null;
  activatedModules?: string[];
  trialUsed?: boolean;
  accessLevel?: SubscriptionAccessLevel;
  suspensionReason?: string;
  cancellationRequestedAt?: string;
  cancellationEffectiveDate?: string;
  cancellationReason?: string;
}

export type SubscriptionPaymentStatus = "En attente" | "Validé" | "Refusé";

/** Paiement d'abonnement SaaS (distinct des paiements scolaires). */
export interface SubscriptionPayment {
  id: string;
  subscriptionId?: string;
  schoolCode: string;
  amount: number;
  currency: string;
  method: string;
  reference: string;
  status: SubscriptionPaymentStatus;
  validatedBy?: string;
  validatedAt?: string;
  receiptId?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string;
  createdAt?: string;
}

export type SubscriptionInvoiceStatus =
  | "Brouillon"
  | "Émise"
  | "Payée"
  | "En retard"
  | "Annulée";

export interface SubscriptionInvoice {
  id: string;
  schoolCode: string;
  subscriptionId?: string;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: SubscriptionInvoiceStatus;
  issuedAt?: string;
  dueDate?: string;
  paidAt?: string;
  paymentId?: string;
}

export type SubscriptionDiscountStatus = "En attente" | "Approuvée" | "Refusée";

export interface SubscriptionDiscount {
  id: string;
  schoolCode?: string;
  offerId?: string;
  amount?: number;
  percent?: number;
  reason: string;
  requestedBy?: string;
  approvedBy?: string;
  status: SubscriptionDiscountStatus;
  createdAt?: string;
}

export interface SubscriptionAuditEntry {
  id: string;
  action: string;
  schoolCode?: string;
  subscriptionId?: string;
  author?: string;
  details?: string;
  createdAt: string;
}

export interface PlatformNotification {
  id?: string;
  audience?: string;
  countryCode?: string;
  schoolCode?: string;
  title: string;
  message: string;
  type?: string;
  priority?: string;
  channels?: string[];
  status?: string;
  date?: string;
  createdBy?: string;
}

export interface UserAccount {
  id?: string;
  publicId?: string;
  /** Contact CRM dont ce compte est l'accès applicatif (UTIL-001). */
  contactId?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  phone?: string;
  email?: string;
  role?: string;
  roles?: string[];
  roleKeys?: string[];
  assignmentStatus?: string;
  secondaryRoles?: string[];
  scopeLevel?: string;
  countryScope?: string;
  /** Alias tenant historique = schools.school_code. Ne pas afficher comme code public. */
  schoolCode?: string;
  /** Code public canonique = schools.login_code. */
  schoolPublicCode?: string;
  schoolName?: string;
  accessChannel?: string;
  identifier?: string;
  status?: string;
  validationStatus?: string;
  validationRequestedBy?: string;
  validationRequestedAt?: string;
  validatedBy?: string | null;
  validatedAt?: string | null;
  permissions?: string[];
  hasTemporaryPassword?: boolean;
  temporaryPassword?: string;
  mustChangePassword?: boolean;
  birthDate?: string;
  password?: string;
  createdAt?: string;
  lastLoginAt?: string;
  createdBy?: string;
  deletedAt?: string;
  suspensionReason?: string;
  history?: string[];
}

export interface SessionUser extends UserAccount {
  mustChangePassword?: boolean;
  /** Affectations pédagogiques projetées depuis le JWT (#248). */
  assignments?: Record<string, unknown>[];
  assignedClassIds?: string[];
  assignedClassCodes?: string[];
  teacherCode?: string;
}

export interface SessionScope {
  label: string;
  hint: string;
}

export interface Session {
  user: SessionUser;
  scope: SessionScope;
  accessToken: string;
  refreshToken?: string;
  permissions?: string[];
  menus?: string[];
  rolePermissions?: Record<string, string[]>;
  academicConfigs?: Record<string, unknown>;
  auditLog?: unknown[];
}

/** Personne référencée dans le CRM Somafrik (socle « contact »). */
export interface Contact {
  id?: string;
  publicId?: string;
  lastName: string;
  firstName: string;
  /** Type métier : Directeur, Secrétaire, Enseignant, Parent, Élève, Étudiant, Comptable, Agent pays, Superadmin. */
  contactType: string;
  /** Compte lié = code de l'établissement (ou compte plateforme). */
  schoolCode: string;
  /** Libellé du compte lié, résolu à l'enregistrement pour l'affichage. */
  accountName?: string;
  phone?: string;
  email?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  /** Actif, Inactif, Archivé, Suspendu. */
  status: string;
  /** « Oui » si un accès utilisateur doit être créé/maintenu (UTIL-001). */
  hasAccess?: string;
  /** Rôle principal de l'accès applicatif. */
  role?: string;
  /** Rôle secondaire optionnel (UTIL-003). */
  secondaryRole?: string;
  /** Compte utilisateur lié généré à partir du contact. */
  userId?: string;
  userIdentifier?: string;
  /** Fiche opérationnelle Élève liée (contact de type Élève/Étudiant). */
  studentId?: string;
  /** Fiche opérationnelle Enseignant liée (contact de type Enseignant). */
  teacherId?: string;
  createdAt?: string;
}

/** Lien entre un contact et une autre entité (REL-001, REL-004). */
export interface Relation {
  id?: string;
  /** « Parent → Élève » ou « Contact → Compte ». */
  relationType: string;
  fromContactId: string;
  fromContactName?: string;
  /** Cible élève (relation parent-enfant). */
  toStudentId?: string;
  toStudentName?: string;
  /** Compte lié (relation contact-compte multiple). */
  accountCode?: string;
  accountName?: string;
  /** Compte de rattachement principal (portée). */
  schoolCode: string;
  status?: string;
  createdAt?: string;
}

/** Statut d'une grille tarifaire (EXG-FRAIS-001). */
export type FeeGridStatus = "Brouillon" | "Active" | "Désactivée" | "Clôturée";

/** Type de frais scolaire dans la grille (EXG-FRAIS-004 à 006). */
export type SchoolFeeType = "Inscription" | "Mensualité" | "Annexe";

/** Statut d'un frais généré pour un élève (EXG-FRAIS-017). */
export type StudentFeeStatus =
  | "À payer"
  | "Partiellement payé"
  | "Payé"
  | "En retard"
  | "Exonéré"
  | "Annulé";

/** Grille tarifaire : règles par classe, année et période (séparée des dettes élève). */
export interface FeeGrid {
  id: string;
  schoolCode: string;
  academicYear: string;
  className: string;
  currency: string;
  status: FeeGridStatus;
  periodName?: string;
  periodStart?: string;
  periodEnd?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Ligne de frais rattachée à une grille. */
export interface SchoolFeeItem {
  id: string;
  feeGridId: string;
  schoolCode: string;
  className: string;
  feeType: SchoolFeeType;
  label: string;
  amount: number;
  periodName?: string;
  mandatory: boolean;
  dueDate?: string;
  /** Mois concernés pour les mensualités (ex. « Septembre », « Octobre »). */
  monthlyMonths?: string[];
  status: "Actif" | "Désactivé";
}

/** Dette générée pour un élève à partir d'une ligne de grille. */
export interface StudentFee {
  id: string;
  studentId: string;
  studentName?: string;
  schoolCode: string;
  className: string;
  schoolFeeItemId: string;
  feeGridId: string;
  feeType: SchoolFeeType;
  label: string;
  currency: string;
  academicYear: string;
  initialAmount: number;
  discount: number;
  exemption: number;
  amountDue: number;
  amountPaid: number;
  balance: number;
  status: StudentFeeStatus;
  dueDate?: string;
  periodLabel?: string;
  createdAt?: string;
}

/** Historique de modification d'un tarif (EXG-FRAIS-018). */
export interface FeeTariffHistory {
  id: string;
  schoolFeeItemId: string;
  schoolCode: string;
  previousAmount: number;
  newAmount: number;
  reason?: string;
  changedBy?: string;
  changedAt: string;
}

/** Niveau de criticité d'un impayé (IMP-008). */
export type UnpaidSeverity = "Retard léger" | "Retard moyen" | "Retard critique";

/** Statut agrégé d'un impayé élève (IMP-014 à IMP-016). */
export type UnpaidAggregateStatus = "En retard" | "Partiellement payé" | "Soldé" | "Annulé";

/** Canal de relance (IMP-010). */
export type ReminderChannel = "notification" | "sms" | "whatsapp" | "email";

/** Destinataire d'une relance. */
export type ReminderRecipient = "Parent" | "Responsable" | "Étudiant";

/** Statut d'envoi d'une relance (IMP-011). */
export type ReminderSendStatus = "Envoyée" | "Échouée" | "En attente";

/** Relance de paiement enregistrée (IMP-011, IMP-012). */
export interface PaymentReminder {
  id: string;
  studentFeeId?: string;
  studentId: string;
  schoolCode: string;
  recipient: ReminderRecipient;
  channel: ReminderChannel;
  message: string;
  summary?: string;
  sentAt: string;
  sendStatus: ReminderSendStatus;
  triggeredBy?: string;
  triggeredByName?: string;
}

/** Ligne agrégée impayé par élève pour la liste (IMP-001). */
export interface StudentUnpaidRow {
  studentId: string;
  studentName: string;
  matricule?: string;
  className: string;
  schoolCode: string;
  periodLabel: string;
  amountExpected: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  dueDate?: string;
  daysLate: number;
  severity: UnpaidSeverity;
  status: UnpaidAggregateStatus;
  feeIds: string[];
  lastReminderAt?: string;
  reminderCount: number;
}

/** Statistiques tableau de bord impayés (IMP-017 à IMP-019). */
export interface UnpaidDashboardStats {
  totalAmountDue: number;
  studentCount: number;
  overdueLineCount: number;
  byClass: { className: string; amountDue: number; studentCount: number }[];
  currency: string;
}

/** NE-001 — Types d'évaluation. */
export type EvaluationType =
  | "Devoir"
  | "Interrogation"
  | "Composition"
  | "Examen"
  | "Rattrapage"
  | "Contrôle continu";

/** Cycle de vie d'une évaluation (NE-001 à NE-003, NE-007). */
export type EvaluationStatus =
  | "Brouillon"
  | "Ouverte"
  | "Saisie terminée"
  | "Validée"
  | "Publiée"
  | "Annulée";

/** Statut d'une note élève (NE-004 à NE-008). */
export type GradeStatus =
  | "Saisie"
  | "Absente"
  | "Justifiée"
  | "Non justifiée"
  | "Dispensée"
  | "Validée"
  | "Corrigée"
  | "En attente";

/** NE-SEC-002 — Historique de modification d'une note. */
export interface GradeAuditEntry {
  authorId: string;
  authorName?: string;
  oldValue?: number | string;
  newValue?: number | string;
  reason?: string;
  action?: string;
  date: string;
}

/** NE-001 — Évaluation pédagogique. */
export interface Evaluation {
  id: string;
  schoolCode: string;
  schoolId?: string;
  academicYear?: string;
  academicYearId?: string;
  classId?: string;
  classCode?: string;
  className: string;
  subjectId?: string;
  subject: string;
  course?: string;
  teacherId?: string;
  teacherName?: string;
  termId?: string;
  period: string;
  evaluationType: string;
  evaluationTypeId?: string;
  title: string;
  date?: string;
  scale: number;
  coefficient: number;
  status: EvaluationStatus;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  history?: GradeAuditEntry[];
  linkedExamId?: string;
}

/** NE-004 — Note élève liée à une évaluation. */
export interface StudentGrade {
  id: string;
  schoolCode: string;
  studentId: string;
  studentName?: string;
  evaluationId: string;
  subject: string;
  className?: string;
  period: string;
  value?: number;
  scale: number;
  evaluationCoefficient?: number;
  coefficient?: number;
  gradeStatus: GradeStatus;
  comment?: string;
  authorId?: string;
  authorName?: string;
  enteredAt?: string;
  validatedBy?: string;
  validatedByName?: string;
  validatedAt?: string;
  date?: string;
  audit?: GradeAuditEntry[];
}

export interface BackOfficeState {
  schools: School[];
  users: UserAccount[];
  countries: Country[];
  contacts: Contact[];
  relations: Relation[];
  subscriptions: Subscription[];
  subscriptionOffers?: SubscriptionOffer[];
  subscriptionPayments?: SubscriptionPayment[];
  subscriptionInvoices?: SubscriptionInvoice[];
  subscriptionDiscounts?: SubscriptionDiscount[];
  subscriptionAuditLog?: SubscriptionAuditEntry[];
  notifications: PlatformNotification[];
  students: Student[];
  persons?: Person[];
  studentEnrollments?: StudentEnrollment[];
  guardians?: Guardian[];
  studentGuardianRelations?: StudentGuardianRelation[];
  studentMedicalProfiles?: StudentMedicalProfile[];
  studentDocuments?: StudentDocument[];
  teachers: unknown[];
  classes: unknown[];
  courses: unknown[];
  assignments: unknown[];
  courseSchedules?: unknown[];
  payments: unknown[];
  presences: unknown[];
  notes: unknown[];
  evaluations?: Evaluation[];
  exams: unknown[];
  bulletins: unknown[];
  documents: unknown[];
  announcements: unknown[];
  messages: unknown[];
  paymentStatuses: unknown[];
  feeGrids?: FeeGrid[];
  schoolFeeItems?: SchoolFeeItem[];
  studentFees?: StudentFee[];
  feeTariffHistory?: FeeTariffHistory[];
  paymentReminders?: PaymentReminder[];
  rolePermissions: Record<string, string[]>;
  academicConfigs: Record<string, unknown>;
  dashboardChartConfig?: DashboardChartConfig;
  auditLog?: unknown[];
}

export type LoginProfile = "superadmin" | "country" | "school";
