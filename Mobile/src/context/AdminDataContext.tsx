import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Announcement,
  AcademicManagementConfig,
  CountryProfile,
  Course,
  NoteItem,
  PaymentItem,
  PaymentStatus,
  PresenceItem,
  SchoolClass,
  SchoolMessage,
  SchoolProfile,
  Student,
  SubscriptionItem,
  Teacher,
  TeacherAssignment,
  UserAccount,
} from "../data/catalog";
import {
  ALL_SCHOOLS_CODE,
  clearStoredSchoolCode,
  pickInitialSchoolCode,
  userRequiresSchoolSelection,
  writeStoredSchoolCode,
} from "../lib/activeSchool";
import { clearRequestSchoolScope, setRequestSchoolScope } from "../lib/requestSchoolScope";
import { normalize } from "../lib/format";
import { scopeBackOfficeForSession, scopedSchools, type PlatformNotification } from "../lib/scope";
import {
  applyCreatedPlatformNotification,
  applyReadPlatformNotification,
  buildPlatformNotificationCreatePayload,
  buildPlatformNotificationReadPatch,
  isUnreadNotification,
} from "../lib/platformNotificationSync";
import { getAcademicConfig, getAssignments, getClasses, getCourses, getPlanningWeekly, getPlanningCourseOptions, getSchoolRooms, getCourseScheduleReplacements, getEvaluations, getNotes, getPayments, getPresences, getReportCards, getStudents, getSubjects, createPlatformNotification, updatePlatformNotification, getEffectivePermissions, createClientsAnnouncement, updateClientsAnnouncement, sendClientsMessage, createClientsUser, updateClientsUser, BackOfficeStatePayload, type CanonicalReportCard } from "../services/api";
import {
  getCanonicalAnnouncements,
  getCanonicalCountries,
  getCanonicalMessages,
  getCanonicalNotifications,
  getCanonicalSchools,
  getCanonicalSubscriptions,
  getCanonicalTeachers,
  getCanonicalUsers,
  type CanonicalAnnouncement,
  type CanonicalSchoolMessage,
  type CanonicalTeacher,
  type CanonicalUserAccount,
} from "../services/domainHydrationApi";
import {
  buildPrincipalScopeKey,
  buildResourceScopeKey,
  emptyResourceSnapshot,
  scopeHydrationPlan,
  snapshotFromFailure,
  snapshotFromSuccess,
  withScopedSnapshotData,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import { mergeConfirmedPresences } from "../lib/attendanceDraft";
import { createIdempotencyKey } from "../lib/networkResilience";
import {
  gradesForEvaluation,
  type CanonicalEvaluation,
  type CanonicalGrade,
} from "../lib/evaluationsV2";
import {
  type CanonicalReplacement,
  type CanonicalSchoolRoom,
  type CanonicalWeeklySlot,
  type PlanningCourseOption,
} from "../lib/planningV2";
import { useAuth } from "./AuthContext";

export type AdminEntity =
  | "students"
  | "teachers"
  | "classes"
  | "countries"
  | "courses"
  | "assignments"
  | "payments"
  | "subscriptions"
  | "paymentStatuses"
  | "schools"
  | "users"
  | "announcements"
  | "messages";

type ScopedEntity = AdminEntity | "presences" | "notes";

type AdminDataContextValue = {
  studentsData: Student[];
  teachersData: Teacher[];
  classesData: SchoolClass[];
  countriesData: CountryProfile[];
  coursesData: Course[];
  assignmentsData: TeacherAssignment[];
  courseSchedulesData: CanonicalWeeklySlot[];
  paymentsData: PaymentItem[];
  paymentsSnapshot: ResourceSnapshot<PaymentItem>;
  usersSnapshot: ResourceSnapshot<CanonicalUserAccount>;
  teachersSnapshot: ResourceSnapshot<CanonicalTeacher>;
  studentsSnapshot: ResourceSnapshot<Student>;
  classesSnapshot: ResourceSnapshot<SchoolClass>;
  presencesSnapshot: ResourceSnapshot<PresenceItem>;
  announcementsSnapshot: ResourceSnapshot<CanonicalAnnouncement>;
  messagesSnapshot: ResourceSnapshot<CanonicalSchoolMessage>;
  schoolsSnapshot: ResourceSnapshot<SchoolProfile>;
  courseSchedulesSnapshot: ResourceSnapshot<CanonicalWeeklySlot>;
  planningCourseOptionsSnapshot: ResourceSnapshot<PlanningCourseOption>;
  roomsSnapshot: ResourceSnapshot<CanonicalSchoolRoom>;
  replacementsSnapshot: ResourceSnapshot<CanonicalReplacement>;
  reportCardsSnapshot: ResourceSnapshot<CanonicalReportCard>;
  loadPayments: () => Promise<void>;
  loadUsers: () => Promise<void>;
  loadTeachers: () => Promise<void>;
  loadStudents: () => Promise<void>;
  loadClasses: () => Promise<void>;
  loadAnnouncements: () => Promise<void>;
  loadMessages: () => Promise<void>;
  loadSchools: () => Promise<void>;
  loadCountries: () => Promise<void>;
  loadSubscriptions: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  loadCourseSchedules: () => Promise<void>;
  loadPlanningWeekly: () => Promise<void>;
  loadPlanningCourseOptions: () => Promise<void>;
  loadRooms: () => Promise<void>;
  loadReplacements: () => Promise<void>;
  loadReportCards: () => Promise<void>;
  evaluationsSnapshot: ResourceSnapshot<CanonicalEvaluation>;
  notesSnapshot: ResourceSnapshot<CanonicalGrade>;
  loadEvaluations: () => Promise<void>;
  loadEvaluation: (evaluationId: string) => Promise<CanonicalEvaluation | null>;
  loadNotes: () => Promise<void>;
  loadEvaluationGrades: (evaluationId: string) => Promise<CanonicalGrade[]>;
  loadPresences: () => Promise<boolean>;
  applyConfirmedPresences: (rows: unknown[]) => void;
  subscriptionsData: SubscriptionItem[];
  paymentStatusesData: PaymentStatus[];
  presencesData: PresenceItem[];
  notesData: NoteItem[];
  schoolsData: SchoolProfile[];
  usersData: UserAccount[];
  announcementsData: Announcement[];
  messagesData: SchoolMessage[];
  notificationsData: PlatformNotification[];
  rolePermissionsData: Record<string, string[]>;
  academicConfigData: AcademicManagementConfig;
  activeSchoolCode: string;
  resourceScopeKey: string;
  availableSchools: SchoolProfile[];
  requiresSchoolSelection: boolean;
  setActiveSchoolCode: (code: string) => void;
  syncStatus: "idle" | "syncing" | "synced" | "offline";
  refreshBackOfficeState: () => Promise<void>;
  getItems: (entity: AdminEntity) => any[];
  createItem: (entity: AdminEntity, item: any) => void;
  updateItem: (entity: AdminEntity, item: any) => void;
  deleteItem: (entity: AdminEntity, id: string) => void;
  upsertPresenceItems: (items: PresenceItem[]) => void;
  upsertNoteItem: (item: NoteItem) => void;
  updateRoleFeatureAccess: (role: string, feature: string, permissions: string[], enabled: boolean) => void;
  upsertNotification: (item: PlatformNotification) => void;
  updateNotification: (item: PlatformNotification) => void;
  markNotificationsRead: (items: PlatformNotification[]) => void;
};

const AdminDataContext = createContext<AdminDataContextValue | undefined>(undefined);

const emptyAcademicConfig: AcademicManagementConfig = {
  schoolCode: "",
  periodMode: "",
  periods: [],
  evaluationTypes: [],
  defaultScale: 0,
  reportCardMode: "",
  levels: [],
  tracks: [],
  classNames: [],
  subjects: [],
};

export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuth();
  const [studentsData, setStudentsData] = useState<Student[]>([]);
  const [teachersData, setTeachersData] = useState<Teacher[]>([]);
  const [classesData, setClassesData] = useState<SchoolClass[]>([]);
  const [countriesData, setCountriesData] = useState<CountryProfile[]>([]);
  const [coursesData, setCoursesData] = useState<Course[]>([]);
  const [assignmentsData, setAssignmentsData] = useState<TeacherAssignment[]>([]);
  const [paymentsData, setPaymentsData] = useState<PaymentItem[]>([]);
  const [subscriptionsData, setSubscriptionsData] = useState<SubscriptionItem[]>([]);
  const [paymentStatusesData, setPaymentStatusesData] = useState<PaymentStatus[]>([]);
  const [presencesData, setPresencesData] = useState<PresenceItem[]>([]);
  const [notesData, setNotesData] = useState<NoteItem[]>([]);
  const [schoolsData, setSchoolsData] = useState<SchoolProfile[]>([]);
  const [usersData, setUsersData] = useState<UserAccount[]>([]);
  const [announcementsData, setAnnouncementsData] = useState<Announcement[]>([]);
  const [messagesData, setMessagesData] = useState<SchoolMessage[]>([]);
  const [notificationsData, setNotificationsData] = useState<PlatformNotification[]>([]);
  const [rolePermissionsData, setRolePermissionsData] = useState<Record<string, string[]>>({});
  const [academicConfigData, setAcademicConfigData] = useState<AcademicManagementConfig>(emptyAcademicConfig);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");
  const [activeSchoolCode, setActiveSchoolCodeState] = useState("");
  const [paymentsSnapshot, setPaymentsSnapshot] = useState<ResourceSnapshot<PaymentItem>>({
    status: "idle",
    data: [],
  });
  const [courseSchedulesSnapshot, setCourseSchedulesSnapshot] = useState<ResourceSnapshot<CanonicalWeeklySlot>>({
    status: "idle",
    data: [],
  });
  const [planningCourseOptionsSnapshot, setPlanningCourseOptionsSnapshot] = useState<ResourceSnapshot<PlanningCourseOption>>({
    status: "idle",
    data: [],
  });
  const [roomsSnapshot, setRoomsSnapshot] = useState<ResourceSnapshot<CanonicalSchoolRoom>>({
    status: "idle",
    data: [],
  });
  const [replacementsSnapshot, setReplacementsSnapshot] = useState<ResourceSnapshot<CanonicalReplacement>>({
    status: "idle",
    data: [],
  });
  const [reportCardsSnapshot, setReportCardsSnapshot] = useState<ResourceSnapshot<CanonicalReportCard>>({
    status: "idle",
    data: [],
  });
  const [evaluationsSnapshot, setEvaluationsSnapshot] = useState<ResourceSnapshot<CanonicalEvaluation>>({
    status: "idle",
    data: [],
  });
  const [notesSnapshot, setNotesSnapshot] = useState<ResourceSnapshot<CanonicalGrade>>({
    status: "idle",
    data: [],
  });
  const [usersSnapshot, setUsersSnapshot] = useState<ResourceSnapshot<CanonicalUserAccount>>({
    status: "idle",
    data: [],
  });
  const [teachersSnapshot, setTeachersSnapshot] = useState<ResourceSnapshot<CanonicalTeacher>>({
    status: "idle",
    data: [],
  });
  const [studentsSnapshot, setStudentsSnapshot] = useState<ResourceSnapshot<Student>>({
    status: "idle",
    data: [],
  });
  const [classesSnapshot, setClassesSnapshot] = useState<ResourceSnapshot<SchoolClass>>({
    status: "idle",
    data: [],
  });
  const [presencesSnapshot, setPresencesSnapshot] = useState<ResourceSnapshot<PresenceItem>>({
    status: "idle",
    data: [],
  });
  const [announcementsSnapshot, setAnnouncementsSnapshot] = useState<ResourceSnapshot<CanonicalAnnouncement>>({
    status: "idle",
    data: [],
  });
  const [messagesSnapshot, setMessagesSnapshot] = useState<ResourceSnapshot<CanonicalSchoolMessage>>({
    status: "idle",
    data: [],
  });
  const [schoolsSnapshot, setSchoolsSnapshot] = useState<ResourceSnapshot<SchoolProfile>>({
    status: "idle",
    data: [],
  });

  const requiresSchoolSelection = userRequiresSchoolSelection(
    session
      ? {
          role: session.role,
          schoolCode: session.user.schoolCode ?? session.school?.code,
        }
      : null,
  );

  const principalScopeKey = useMemo(
    () =>
      buildPrincipalScopeKey({
        hasSession: Boolean(session),
        userId: session?.user?.id,
        role: session?.role,
        schoolCode: session?.user?.schoolCode ?? session?.school?.code,
        countryScope: session?.user?.countryScope ?? session?.user?.countryCode,
      }),
    [session],
  );
  const resourceScopeKey = useMemo(
    () =>
      buildResourceScopeKey({
        hasSession: Boolean(session),
        userId: session?.user?.id,
        role: session?.role,
        schoolCode: session?.user?.schoolCode ?? session?.school?.code,
        countryScope: session?.user?.countryScope ?? session?.user?.countryCode,
        activeSchoolCode: requiresSchoolSelection
          ? activeSchoolCode
          : session?.user?.schoolCode ?? session?.school?.code,
      }),
    [session, activeSchoolCode, requiresSchoolSelection],
  );
  const resourceScopeKeyRef = useRef(resourceScopeKey);
  resourceScopeKeyRef.current = resourceScopeKey;
  const principalScopeKeyRef = useRef(principalScopeKey);
  principalScopeKeyRef.current = principalScopeKey;
  const previousPrincipalKeyRef = useRef<string | null>(null);

  const resetTenantResourceCaches = useCallback(() => {
    setStudentsData([]);
    setTeachersData([]);
    setClassesData([]);
    setCoursesData([]);
    setAssignmentsData([]);
    setPaymentsData([]);
    setPaymentStatusesData([]);
    setPresencesData([]);
    setNotesData([]);
    setUsersData([]);
    setAnnouncementsData([]);
    setMessagesData([]);
    setAcademicConfigData(emptyAcademicConfig);
    setSyncStatus("idle");
    setPaymentsSnapshot(emptyResourceSnapshot());
    setCourseSchedulesSnapshot(emptyResourceSnapshot());
    setPlanningCourseOptionsSnapshot(emptyResourceSnapshot());
    setRoomsSnapshot(emptyResourceSnapshot());
    setReplacementsSnapshot(emptyResourceSnapshot());
    setReportCardsSnapshot(emptyResourceSnapshot());
    setEvaluationsSnapshot(emptyResourceSnapshot());
    setNotesSnapshot(emptyResourceSnapshot());
    setUsersSnapshot(emptyResourceSnapshot());
    setTeachersSnapshot(emptyResourceSnapshot());
    setStudentsSnapshot(emptyResourceSnapshot());
    setClassesSnapshot(emptyResourceSnapshot());
    setPresencesSnapshot(emptyResourceSnapshot());
    setAnnouncementsSnapshot(emptyResourceSnapshot());
    setMessagesSnapshot(emptyResourceSnapshot());
  }, []);

  const resetPrincipalResourceCaches = useCallback(() => {
    resetTenantResourceCaches();
    setSchoolsData([]);
    setSchoolsSnapshot(emptyResourceSnapshot());
    setCountriesData([]);
    setSubscriptionsData([]);
    setNotificationsData([]);
    setRolePermissionsData({});
  }, [resetTenantResourceCaches]);

  const resetResourceCaches = resetPrincipalResourceCaches;

  const scopeUser = useMemo(
    () =>
      session
        ? {
            role: session.role,
            countryScope: session.user.countryScope ?? session.user.countryCode,
            schoolCode: session.user.schoolCode ?? session.school?.code,
          }
        : null,
    [session],
  );

  const availableSchools = useMemo(() => {
    if (!scopeUser) return [] as SchoolProfile[];
    return scopedSchools(scopeUser, {
      schools: schoolsData,
      users: usersData,
      countries: countriesData,
      subscriptions: subscriptionsData,
      notifications: notificationsData,
    }) as SchoolProfile[];
  }, [scopeUser, schoolsData, usersData, countriesData, subscriptionsData, notificationsData]);

  useEffect(() => {
    const codes = availableSchools.map((school) => school.code);
    setActiveSchoolCodeState((current) => {
      const next = pickInitialSchoolCode(scopeUser, codes);
      if (!current) return next;
      if (codes.some((code) => normalize(code) === normalize(current))) return current;
      return next;
    });
  }, [scopeUser?.role, scopeUser?.countryScope, availableSchools.map((s) => s.code).join("|")]);

  const setActiveSchoolCode = (code: string) => {
    setActiveSchoolCodeState(code);
    writeStoredSchoolCode(code);
    setRequestSchoolScope(code);
  };

  useEffect(() => {
    setRequestSchoolScope(activeSchoolCode);
  }, [activeSchoolCode]);

  const stateSnapshot = useMemo(
    () => ({
      students: studentsData,
      teachers: teachersData,
      classes: classesData,
      countries: countriesData,
      courses: coursesData,
      assignments: assignmentsData,
      payments: paymentsData,
      subscriptions: subscriptionsData,
      paymentStatuses: paymentStatusesData,
      presences: presencesData,
      notes: notesData,
      schools: schoolsData,
      users: usersData,
      announcements: announcementsData,
      messages: messagesData,
      notifications: notificationsData,
      rolePermissions: rolePermissionsData,
      academicConfigs: { [academicConfigData.schoolCode]: academicConfigData },
    }),
    [
      announcementsData,
      assignmentsData,
      classesData,
      countriesData,
      coursesData,
      messagesData,
      notesData,
      paymentsData,
      paymentStatusesData,
      presencesData,
      schoolsData,
      studentsData,
      subscriptionsData,
      teachersData,
      usersData,
      rolePermissionsData,
      academicConfigData,
      notificationsData,
    ]
  );
  const scopedStateSnapshot = useMemo(
    () =>
      scopeBackOfficeForSession(
        stateSnapshot,
        session,
        requiresSchoolSelection ? activeSchoolCode : undefined,
      ),
    [session, stateSnapshot, activeSchoolCode, requiresSchoolSelection]
  );

  const applySyncedState = (payload: BackOfficeStatePayload) => {
    applyArray(payload.students, setStudentsData);
    applyArray(payload.teachers, setTeachersData);
    applyArray(payload.classes, setClassesData);
    applyArray(payload.countries, setCountriesData);
    applyArray(payload.courses, setCoursesData);
    applyArray(payload.assignments, setAssignmentsData);
    applyArray(payload.payments, setPaymentsData);
    applyArray(payload.subscriptions, setSubscriptionsData);
    applyArray(payload.paymentStatuses, setPaymentStatusesData);
    applyArray(payload.presences, setPresencesData);
    applyArray(payload.notes, setNotesData);
    applyArray(payload.schools, setSchoolsData);
    applyArray(payload.users, setUsersData);
    applyArray(payload.announcements, setAnnouncementsData);
    applyArray(payload.messages, setMessagesData);
    applyArray(payload.notifications, setNotificationsData);
    if (payload.rolePermissions && typeof payload.rolePermissions === "object") {
      setRolePermissionsData(payload.rolePermissions);
    }
    if (payload.academicConfigs && typeof payload.academicConfigs === "object") {
      const configs = payload.academicConfigs as Record<string, AcademicManagementConfig>;
      const targetCode =
        activeSchoolCode && activeSchoolCode !== ALL_SCHOOLS_CODE
          ? activeSchoolCode
          : session?.user?.schoolCode ?? session?.school?.code;
      const config = (targetCode && configs[targetCode]) || Object.values(configs)[0];
      if (config) setAcademicConfigData({ ...config, subjects: [] });
    }
  };

  const refreshBackOfficeState = useCallback(async () => {
    if (!session) {
      return;
    }
    const scope = resourceScopeKeyRef.current;

    setSyncStatus("syncing");

    try {
      const [
        studentPayload,
        classPayload,
        coursePayload,
        notePayload,
        presencePayload,
        academicConfigPayload,
        assignmentPayload,
        subjectPayload,
      ] = await Promise.all([
        getStudents(),
        getClasses(),
        getCourses(),
        getNotes(),
        getPresences(),
        getAcademicConfig(),
        getAssignments(),
        getSubjects(),
      ]);

      if (resourceScopeKeyRef.current !== scope) return;

      applyArray(studentPayload, setStudentsData);
      applyArray(classPayload, setClassesData);
      applyArray(coursePayload, setCoursesData);
      const studentRows = Array.isArray(studentPayload) ? (studentPayload as Student[]) : [];
      const classRows = Array.isArray(classPayload) ? (classPayload as SchoolClass[]) : [];
      const presenceRows = Array.isArray(presencePayload) ? (presencePayload as PresenceItem[]) : [];
      setStudentsSnapshot(snapshotFromSuccess(studentRows));
      setClassesSnapshot(snapshotFromSuccess(classRows));
      const canonicalNotes = Array.isArray(notePayload) ? notePayload : [];
      setNotesSnapshot(snapshotFromSuccess(canonicalNotes));
      setNotesData(canonicalNotes.map(canonicalGradeToNoteItem));
      applyArray(presencePayload, setPresencesData);
      setPresencesSnapshot(snapshotFromSuccess(presenceRows));
      applyArray(assignmentPayload, setAssignmentsData);
      const subjectRows = Array.isArray(subjectPayload)
        ? subjectPayload
        : subjectPayload && typeof subjectPayload === "object" && Array.isArray((subjectPayload as { items?: unknown[] }).items)
          ? (subjectPayload as { items: unknown[] }).items
          : [];
      const subjectNames = subjectRows
        .map((row) => String((row as { name?: string }).name ?? "").trim())
        .filter(Boolean);
      setAcademicConfigData({
        ...(academicConfigPayload as AcademicManagementConfig),
        subjects: subjectNames,
      });
      setSyncStatus("synced");
    } catch {
      if (resourceScopeKeyRef.current !== scope) return;
      setSyncStatus("offline");
      throw new Error("Synchronisation impossible");
    }
  }, [session]);

  const loadPayments = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setPaymentsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getPayments()) as PaymentItem[];
      if (resourceScopeKeyRef.current !== scope) return;
      setPaymentsData(rows);
      setPaymentsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setPaymentsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadUsers = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setUsersSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalUsers();
      if (resourceScopeKeyRef.current !== scope) return;
      setUsersData(rows);
      setUsersSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setUsersSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadTeachers = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setTeachersSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalTeachers();
      if (resourceScopeKeyRef.current !== scope) return;
      setTeachersData(rows);
      setTeachersSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setTeachersSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadStudents = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setStudentsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getStudents()) as Student[];
      if (resourceScopeKeyRef.current !== scope) return;
      setStudentsData(rows);
      setStudentsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setStudentsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadClasses = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setClassesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getClasses()) as SchoolClass[];
      if (resourceScopeKeyRef.current !== scope) return;
      setClassesData(rows);
      setClassesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setClassesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadAnnouncements = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setAnnouncementsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalAnnouncements();
      if (resourceScopeKeyRef.current !== scope) return;
      setAnnouncementsData(rows);
      setAnnouncementsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setAnnouncementsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadMessages = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setMessagesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalMessages();
      if (resourceScopeKeyRef.current !== scope) return;
      setMessagesData(rows);
      setMessagesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setMessagesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadSchools = useCallback(async () => {
    if (!session) return;
    const scope = principalScopeKeyRef.current;
    setSchoolsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalSchools();
      if (principalScopeKeyRef.current !== scope) return;
      setSchoolsData(rows);
      setSchoolsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (principalScopeKeyRef.current !== scope) return;
      setSchoolsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadCountries = useCallback(async () => {
    if (!session) return;
    const scope = principalScopeKeyRef.current;
    try {
      const rows = await getCanonicalCountries();
      if (principalScopeKeyRef.current !== scope) return;
      setCountriesData(rows);
    } catch {
      if (principalScopeKeyRef.current !== scope) return;
    }
  }, [session]);

  const loadSubscriptions = useCallback(async () => {
    if (!session) return;
    const scope = principalScopeKeyRef.current;
    try {
      const rows = await getCanonicalSubscriptions();
      if (principalScopeKeyRef.current !== scope) return;
      setSubscriptionsData(rows);
    } catch {
      if (principalScopeKeyRef.current !== scope) return;
    }
  }, [session]);

  const loadNotifications = useCallback(async () => {
    if (!session) return;
    const scope = principalScopeKeyRef.current;
    try {
      const rows = await getCanonicalNotifications();
      if (principalScopeKeyRef.current !== scope) return;
      setNotificationsData(rows);
    } catch {
      if (principalScopeKeyRef.current !== scope) return;
    }
  }, [session]);

  const loadPlanningWeekly = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setCourseSchedulesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getPlanningWeekly();
      if (resourceScopeKeyRef.current !== scope) return;
      setCourseSchedulesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setCourseSchedulesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadPlanningCourseOptions = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setPlanningCourseOptionsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getPlanningCourseOptions();
      if (resourceScopeKeyRef.current !== scope) return;
      setPlanningCourseOptionsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setPlanningCourseOptionsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadRooms = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setRoomsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getSchoolRooms();
      if (resourceScopeKeyRef.current !== scope) return;
      setRoomsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setRoomsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadReplacements = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setReplacementsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCourseScheduleReplacements();
      if (resourceScopeKeyRef.current !== scope) return;
      setReplacementsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setReplacementsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadReportCards = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setReportCardsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getReportCards();
      if (resourceScopeKeyRef.current !== scope) return;
      setReportCardsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setReportCardsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadEvaluations = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setEvaluationsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getEvaluations();
      if (resourceScopeKeyRef.current !== scope) return;
      setEvaluationsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setEvaluationsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadEvaluation = useCallback(
    async (evaluationId: string) => {
      const key = String(evaluationId ?? "").trim();
      if (!session || !key) return null;
      const scope = resourceScopeKeyRef.current;
      setEvaluationsSnapshot((current) => ({ ...current, status: "loading" }));
      try {
        const rows = await getEvaluations();
        if (resourceScopeKeyRef.current !== scope) return null;
        setEvaluationsSnapshot(snapshotFromSuccess(rows));
        return (
          rows.find(
            (row) =>
              row.evaluationId === key || row.id === key || row.pgId === key || String(row.publicId ?? "") === key,
          ) ?? null
        );
      } catch (error) {
        if (resourceScopeKeyRef.current !== scope) return null;
        setEvaluationsSnapshot((current) => snapshotFromFailure(error, current.data));
        throw error;
      }
    },
    [session],
  );

  const loadNotes = useCallback(async () => {
    if (!session) return;
    const scope = resourceScopeKeyRef.current;
    setNotesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getNotes();
      if (resourceScopeKeyRef.current !== scope) return;
      setNotesSnapshot(snapshotFromSuccess(rows));
      setNotesData(rows.map(canonicalGradeToNoteItem));
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return;
      setNotesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const applyConfirmedPresences = useCallback((rows: unknown[]) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const saved = rows as PresenceItem[];
    setPresencesData((current) => mergeConfirmedPresences(current, saved));
    setPresencesSnapshot((current) => snapshotFromSuccess(mergeConfirmedPresences(current.data, saved)));
  }, []);

  const loadPresences = useCallback(async () => {
    if (!session) return false;
    const scope = resourceScopeKeyRef.current;
    setPresencesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getPresences()) as PresenceItem[];
      if (resourceScopeKeyRef.current !== scope) return false;
      applyArray(rows, setPresencesData);
      setPresencesSnapshot(snapshotFromSuccess(rows));
      return true;
    } catch (error) {
      if (resourceScopeKeyRef.current !== scope) return false;
      setPresencesSnapshot((current) => snapshotFromFailure(error, current.data));
      return false;
    }
  }, [session]);

  const loadEvaluationGrades = useCallback(
    async (evaluationId: string) => {
      if (!session) return [];
      const scope = resourceScopeKeyRef.current;
      setNotesSnapshot((current) => ({ ...current, status: "loading" }));
      try {
        const rows = await getNotes();
        if (resourceScopeKeyRef.current !== scope) return [];
        setNotesSnapshot(snapshotFromSuccess(rows));
        setNotesData(rows.map(canonicalGradeToNoteItem));
        return gradesForEvaluation(rows, evaluationId);
      } catch (error) {
        if (resourceScopeKeyRef.current !== scope) return [];
        setNotesSnapshot((current) => snapshotFromFailure(error, current.data));
        throw error;
      }
    },
    [session],
  );

  const scopedLoadersRef = useRef({
    refreshBackOfficeState,
    loadUsers,
    loadTeachers,
    loadPayments,
    loadAnnouncements,
    loadMessages,
    loadSchools,
    loadCountries,
    loadSubscriptions,
    loadNotifications,
  });
  scopedLoadersRef.current = {
    refreshBackOfficeState,
    loadUsers,
    loadTeachers,
    loadPayments,
    loadAnnouncements,
    loadMessages,
    loadSchools,
    loadCountries,
    loadSubscriptions,
    loadNotifications,
  };

  useEffect(() => {
    const plan = scopeHydrationPlan({
      previousPrincipalKey: previousPrincipalKeyRef.current,
      nextPrincipalKey: principalScopeKey,
      nextResourceKey: resourceScopeKey,
    });
    previousPrincipalKeyRef.current = principalScopeKey;
    if (plan.resetKind === "principal") {
      resetResourceCaches();
      clearRequestSchoolScope();
      if (requiresSchoolSelection) {
        setActiveSchoolCodeState("");
        clearStoredSchoolCode();
      }
    } else {
      resetTenantResourceCaches();
    }
    if (!plan.loadPrincipal && !plan.loadTenant) {
      setActiveSchoolCodeState("");
      clearStoredSchoolCode();
      clearRequestSchoolScope();
      return;
    }
    const loaders = scopedLoadersRef.current;
    if (plan.loadPrincipal) {
      void loaders.loadSchools();
      void loaders.loadCountries();
      void loaders.loadSubscriptions();
      void loaders.loadNotifications();
    }
    const tenantReady =
      !requiresSchoolSelection || Boolean(activeSchoolCode && activeSchoolCode !== ALL_SCHOOLS_CODE);
    const skipTenantUntilSchoolChosen = requiresSchoolSelection && plan.resetKind === "principal";
    if (plan.loadTenant && tenantReady && !skipTenantUntilSchoolChosen) {
      void loaders.refreshBackOfficeState().catch(() => null);
      void loaders.loadUsers();
      void loaders.loadTeachers();
      void loaders.loadPayments();
      void loaders.loadAnnouncements();
      void loaders.loadMessages();
    }
  }, [
    principalScopeKey,
    resourceScopeKey,
    requiresSchoolSelection,
    activeSchoolCode,
    resetResourceCaches,
    resetPrincipalResourceCaches,
    resetTenantResourceCaches,
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const handleOnline = () => {
      refreshBackOfficeState().catch(() => null);
    };

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", handleOnline);
      return () => window.removeEventListener("online", handleOnline);
    }

    return undefined;
  }, [session, refreshBackOfficeState]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    void getEffectivePermissions()
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.permissions)) return;
        const currentPermissions = session.permissions ?? session.user?.permissions ?? [];
        if (sameStringSet(currentPermissions, payload.permissions)) return;
        setSession({
          ...session,
          permissions: payload.permissions,
          user: {
            ...session.user,
            permissions: payload.permissions,
          },
        });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, setSession]);

  const persistSyncedState = (_nextState: BackOfficeStatePayload) => {
    throw Object.assign(
      new Error("La synchronisation globale BackOffice State a été supprimée. Utilisez les API dédiées."),
      { code: "BACKOFFICE_STATE_WRITE_REMOVED" },
    );
  };

  const value = useMemo<AdminDataContextValue>(() => {
    const state = scopedStateSnapshot;
    const tenantFilterCode = requiresSchoolSelection ? activeSchoolCode : undefined;
    const presentScopedSnapshot = <T,>(snapshot: ResourceSnapshot<T>, entity: string): ResourceSnapshot<T> => {
      const sourceRows =
        snapshot.status === "idle"
          ? (((state as Record<string, unknown>)[entity] as T[] | undefined) ?? [])
          : snapshot.data;
      const scoped = scopeBackOfficeForSession(
        { ...stateSnapshot, [entity]: sourceRows },
        session,
        tenantFilterCode,
      );
      const rows = ((scoped as Record<string, unknown>)[entity] as T[] | undefined) ?? [];
      return withScopedSnapshotData(snapshot, rows);
    };
    const presentedUsersSnapshot = presentScopedSnapshot(usersSnapshot, "users");
    const presentedTeachersSnapshot = presentScopedSnapshot(teachersSnapshot, "teachers");
    const presentedStudentsSnapshot = presentScopedSnapshot(studentsSnapshot, "students");
    const presentedClassesSnapshot = presentScopedSnapshot(classesSnapshot, "classes");
    const presentedPresencesSnapshot = presentScopedSnapshot(presencesSnapshot, "presences");
    const presentedPaymentsSnapshot = presentScopedSnapshot(paymentsSnapshot, "payments");
    const presentedAnnouncementsSnapshot = presentScopedSnapshot(announcementsSnapshot, "announcements");
    const presentedMessagesSnapshot = presentScopedSnapshot(messagesSnapshot, "messages");

    const setters = {
      students: setStudentsData,
      teachers: setTeachersData,
      classes: setClassesData,
      countries: setCountriesData,
      courses: setCoursesData,
      assignments: setAssignmentsData,
      payments: setPaymentsData,
      subscriptions: setSubscriptionsData,
      paymentStatuses: setPaymentStatusesData,
      schools: setSchoolsData,
      users: setUsersData,
      announcements: setAnnouncementsData,
      messages: setMessagesData,
    };

    const commitEntity = (entity: AdminEntity, updater: (items: any[]) => any[]) => {
      if (entity === "countries" || entity === "subscriptions") {
        return;
      }
      if (entity === "users" || entity === "announcements" || entity === "messages") {
        setters[entity]((items: any[]) =>
          enforceEntityScope(entity, updater(items), session, state),
        );
        return;
      }
      setters[entity]((items: any[]) => {
        const nextItems = enforceEntityScope(entity, updater(items), session, state);
        persistSyncedState({ ...state, [entity]: nextItems });
        return nextItems;
      });
    };

    const updateRoleFeatureAccess = (role: string, feature: string, permissions: string[], enabled: boolean) => {
      const featurePrefix = `${feature}:`;
      const allowedPermissions = [...new Set(permissions.filter((permission) => permission.startsWith(featurePrefix)))];
      if (!role || !allowedPermissions.length) {
        return;
      }

      setRolePermissionsData((current) => {
        const nextRolePermissions = new Set(current[role] ?? []);
        allowedPermissions.forEach((permission) => {
          if (enabled) {
            nextRolePermissions.add(permission);
          } else {
            nextRolePermissions.delete(permission);
          }
        });

        const nextRolePermissionList = [...nextRolePermissions].sort();
        const nextPermissions = {
          ...current,
          [role]: nextRolePermissionList,
        };
        const nextUsers = (state.users ?? []).map((user: any) =>
          user.role === role ? { ...user, permissions: nextRolePermissionList } : user
        );

        setUsersData(nextUsers as UserAccount[]);
        return nextPermissions;
      });
    };

    return {
      studentsData: presentedStudentsSnapshot.data as Student[],
      teachersData: presentedTeachersSnapshot.data as Teacher[],
      classesData: presentedClassesSnapshot.data as SchoolClass[],
      countriesData: (state.countries ?? []) as CountryProfile[],
      coursesData: (state.courses ?? []) as Course[],
      assignmentsData: (state.assignments ?? []) as TeacherAssignment[],
      courseSchedulesData: courseSchedulesSnapshot.data,
      paymentsData: presentedPaymentsSnapshot.data as PaymentItem[],
      paymentsSnapshot: presentedPaymentsSnapshot,
      usersSnapshot: presentedUsersSnapshot,
      teachersSnapshot: presentedTeachersSnapshot,
      studentsSnapshot: presentedStudentsSnapshot,
      classesSnapshot: presentedClassesSnapshot,
      presencesSnapshot: presentedPresencesSnapshot,
      announcementsSnapshot: presentedAnnouncementsSnapshot,
      messagesSnapshot: presentedMessagesSnapshot,
      schoolsSnapshot,
      courseSchedulesSnapshot,
      planningCourseOptionsSnapshot,
      roomsSnapshot,
      replacementsSnapshot,
      reportCardsSnapshot,
      evaluationsSnapshot,
      notesSnapshot,
      loadPayments,
      loadUsers,
      loadTeachers,
      loadStudents,
      loadClasses,
      loadAnnouncements,
      loadMessages,
      loadSchools,
      loadCountries,
      loadSubscriptions,
      loadNotifications,
      loadCourseSchedules: loadPlanningWeekly,
      loadPlanningWeekly,
      loadPlanningCourseOptions,
      loadRooms,
      loadReplacements,
      loadReportCards,
      loadEvaluations,
      loadEvaluation,
      loadNotes,
      loadEvaluationGrades,
      loadPresences,
      applyConfirmedPresences,
      subscriptionsData: (state.subscriptions ?? []) as SubscriptionItem[],
      paymentStatusesData: (state.paymentStatuses ?? []) as PaymentStatus[],
      presencesData: presentedPresencesSnapshot.data as PresenceItem[],
      notesData: (state.notes ?? []) as NoteItem[],
      schoolsData: (state.schools ?? []) as SchoolProfile[],
      usersData: presentedUsersSnapshot.data as UserAccount[],
      announcementsData: presentedAnnouncementsSnapshot.data as Announcement[],
      messagesData: presentedMessagesSnapshot.data as SchoolMessage[],
      notificationsData: (state.notifications ?? []) as PlatformNotification[],
      rolePermissionsData,
      academicConfigData,
      activeSchoolCode,
      resourceScopeKey,
      availableSchools,
      requiresSchoolSelection,
      setActiveSchoolCode,
      syncStatus,
      refreshBackOfficeState,
      getItems: (entity) => {
        if (entity === "users") return presentedUsersSnapshot.data;
        if (entity === "teachers") return presentedTeachersSnapshot.data;
        if (entity === "students") return presentedStudentsSnapshot.data;
        if (entity === "classes") return presentedClassesSnapshot.data;
        if (entity === "payments") return presentedPaymentsSnapshot.data;
        if (entity === "announcements") return presentedAnnouncementsSnapshot.data;
        if (entity === "messages") return presentedMessagesSnapshot.data;
        return state[entity];
      },
      createItem: (entity, item) => {
        if (
          entity === "classes" || entity === "schools" || entity === "students" ||
          entity === "teachers" || entity === "assignments" ||
          entity === "payments" || entity === "paymentStatuses" ||
          entity === "courses"
        ) return;
        if (entity === "announcements") {
          void createClientsAnnouncement(item as Record<string, unknown>)
            .then((created) => {
              const row = created as CanonicalAnnouncement;
              setAnnouncementsData((current) => [row, ...current]);
              setAnnouncementsSnapshot((current) => snapshotFromSuccess([row, ...current.data]));
            })
            .catch(() => setSyncStatus("offline"));
          return;
        }
        if (entity === "messages") {
          void sendClientsMessage(item as Record<string, unknown>, { idempotencyKey: createIdempotencyKey() })
            .then((created) => {
              const row = created as CanonicalSchoolMessage;
              setMessagesData((current) => [row, ...current]);
              setMessagesSnapshot((current) => snapshotFromSuccess([row, ...current.data]));
            })
            .catch(() => setSyncStatus("offline"));
          return;
        }
        if (entity === "users") {
          void createClientsUser(item as Record<string, unknown>)
            .then((created) => {
              const row = created as CanonicalUserAccount;
              setUsersData((current) => [row, ...current]);
              setUsersSnapshot((current) => snapshotFromSuccess([row, ...current.data]));
            })
            .catch(() => setSyncStatus("offline"));
          return;
        }
        commitEntity(entity, (items) => [applyItemScope(entity, item, session, state), ...items]);
      },
      updateItem: (entity, item) => {
        if (
          entity === "classes" || entity === "schools" || entity === "students" ||
          entity === "teachers" || entity === "assignments" ||
          entity === "payments" || entity === "paymentStatuses" ||
          entity === "courses"
        ) return;
        if (entity === "announcements") {
          void updateClientsAnnouncement(String(item.id), item as Record<string, unknown>)
            .then((updated) =>
              setAnnouncementsData((current) =>
                current.map((row) => (row.id === item.id ? (updated as Announcement) : row)),
              ),
            )
            .catch(() => setSyncStatus("offline"));
          return;
        }
        if (entity === "users") {
          void updateClientsUser(String(item.id), item as Record<string, unknown>)
            .then((updated) =>
              setUsersData((current) =>
                current.map((row) => (row.id === item.id ? (updated as UserAccount) : row)),
              ),
            )
            .catch(() => setSyncStatus("offline"));
          return;
        }
        commitEntity(entity, (items) => items.map((row) => (row.id === item.id ? applyItemScope(entity, item, session, state) : row)));
      },
      deleteItem: (entity, id) => {
        if (
          entity === "classes" || entity === "schools" || entity === "students" ||
          entity === "teachers" || entity === "assignments" ||
          entity === "payments" || entity === "paymentStatuses" ||
          entity === "courses"
        ) return;
        commitEntity(entity, (items) => items.filter((row) => row.id !== id));
      },
      upsertPresenceItems: (items) => {
        setPresencesData((current) => {
          const scopedItems = items.map((item) => applyItemScope("presences", item, session, state));
          const keys = new Set(scopedItems.map((item) => `${item.studentId}-${item.date}`));
          const next = enforceEntityScope(
            "presences",
            [...scopedItems, ...current.filter((item) => !keys.has(`${item.studentId}-${item.date}`))],
            session,
            state,
          );
          setPresencesSnapshot(snapshotFromSuccess(next));
          return next;
        });
      },
      upsertNoteItem: (item) =>
        setNotesData((current) => {
          const scopedItem = applyItemScope("notes", item, session, state);
          const exists = current.some((row) => row.id === scopedItem.id);
          return enforceEntityScope(
            "notes",
            exists ? current.map((row) => (row.id === scopedItem.id ? scopedItem : row)) : [scopedItem, ...current],
            session,
            state,
          );
        }),
      updateRoleFeatureAccess,
      upsertNotification: (item) => {
        const clientId = item.id;
        const payload = buildPlatformNotificationCreatePayload(item);
        void createPlatformNotification(payload)
          .then((created) => {
            const saved = created as PlatformNotification;
            setNotificationsData((current) =>
              applyCreatedPlatformNotification(current, saved, clientId),
            );
            setSyncStatus("synced");
          })
          .catch(() => setSyncStatus("offline"));
      },
      updateNotification: (item) => {
        let patchTarget: { id: string; patch: Record<string, unknown> };
        try {
          patchTarget = buildPlatformNotificationReadPatch(item);
        } catch {
          setSyncStatus("offline");
          return;
        }
        setNotificationsData((current) =>
          current.map((row) => (row.id === item.id ? { ...row, ...item } : row)),
        );
        void updatePlatformNotification(patchTarget.id, patchTarget.patch)
          .then((updated) => {
            setNotificationsData((current) =>
              applyReadPlatformNotification(current, updated as PlatformNotification),
            );
            setSyncStatus("synced");
          })
          .catch(() => setSyncStatus("offline"));
      },
      markNotificationsRead: (items) => {
        const targets = items.filter((item) => item.id && isUnreadNotification(item));
        if (!targets.length) return;

        const targetIds = new Set(targets.map((item) => String(item.id)));
        setNotificationsData((current) =>
          current.map((row) =>
            targetIds.has(String(row.id ?? "")) ? { ...row, status: "Lu" } : row,
          ),
        );

        void Promise.all(
          targets.map((item) => {
            const { id, patch } = buildPlatformNotificationReadPatch(item);
            return updatePlatformNotification(id, patch);
          }),
        )
          .then((updatedRows) => {
            const byId = new Map(
              updatedRows.map((row) => [String((row as PlatformNotification).id), row as PlatformNotification]),
            );
            setNotificationsData((current) =>
              current.map((row) => byId.get(String(row.id ?? "")) ?? row),
            );
            setSyncStatus("synced");
          })
          .catch(() => setSyncStatus("offline"));
      },
    };
  }, [
    announcementsData,
    academicConfigData,
    assignmentsData,
    classesData,
    countriesData,
    coursesData,
    messagesData,
    notesData,
    paymentsData,
    subscriptionsData,
    paymentStatusesData,
    presencesData,
    schoolsData,
    studentsData,
    teachersData,
    usersData,
    rolePermissionsData,
    activeSchoolCode,
    resourceScopeKey,
    availableSchools,
    requiresSchoolSelection,
    session,
    session?.role,
    session?.school?.code,
    session?.user.schoolCode,
    scopedStateSnapshot,
    stateSnapshot,
    syncStatus,
    refreshBackOfficeState,
    paymentsSnapshot,
    courseSchedulesSnapshot,
    planningCourseOptionsSnapshot,
    roomsSnapshot,
    replacementsSnapshot,
    reportCardsSnapshot,
    evaluationsSnapshot,
    notesSnapshot,
    usersSnapshot,
    teachersSnapshot,
    studentsSnapshot,
    classesSnapshot,
    presencesSnapshot,
    announcementsSnapshot,
    messagesSnapshot,
    schoolsSnapshot,
    loadPayments,
    loadUsers,
    loadTeachers,
    loadStudents,
    loadClasses,
    loadAnnouncements,
    loadMessages,
    loadSchools,
    loadCountries,
    loadSubscriptions,
    loadNotifications,
    loadPlanningWeekly,
    loadPlanningCourseOptions,
    loadRooms,
    loadReplacements,
    loadReportCards,
    loadEvaluations,
    loadEvaluation,
    loadNotes,
    loadEvaluationGrades,
    loadPresences,
    applyConfirmedPresences,
  ]);

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

function applyArray<T>(value: unknown, setter: React.Dispatch<React.SetStateAction<T[]>>) {
  if (Array.isArray(value)) {
    setter(value as T[]);
  }
}

function canonicalGradeToNoteItem(grade: CanonicalGrade): NoteItem {
  return {
    id: grade.id,
    studentId: grade.studentId,
    subject: grade.subject ?? "",
    value: Number(grade.value ?? grade.score ?? 0),
    coefficient: grade.evaluationCoefficient,
    date: grade.date ?? "",
    period: grade.period,
    evaluationId: grade.evaluationId,
    evaluationTitle: grade.evaluationTitle,
    evaluationType: grade.evaluationType,
    scale: grade.scale,
    evaluationCoefficient: grade.evaluationCoefficient,
    gradeStatus: grade.gradeStatus,
    status: grade.status,
  };
}

function getSessionSchoolCode(session: any) {
  return String(session?.user?.schoolCode && session.user.schoolCode !== "*" ? session.user.schoolCode : session?.school?.code ?? "")
    .trim()
    .toUpperCase();
}

function filterBySchool(value: unknown, schoolCode: string) {
  return filterRows(value, (item) => rowInSchool(item, schoolCode));
}

function applyItemScope(entity: ScopedEntity, item: any, session: any, state: BackOfficeStatePayload) {
  const establishmentRoles = new Set(["school_admin", "principal", "prefet", "secretary"]);
  if (!item || !establishmentRoles.has(String(session?.role ?? ""))) {
    return item;
  }

  const schoolCode = getSessionSchoolCode(session);
  if (!schoolCode) {
    return item;
  }

  if (entity === "schools" || entity === "subscriptions" || entity === "countries") {
    return item;
  }

  const scopedItem = { ...item };
  if (entityNeedsSchoolCode(entity)) {
    scopedItem.schoolCode = schoolCode;
  }

  if (entity === "payments" || entity === "messages" || entity === "presences" || entity === "notes") {
    const student = findStudentForScopedItem(scopedItem, state) as any;
    if (student?.schoolCode) {
      scopedItem.schoolCode = student.schoolCode;
    }
  }

  if (entity === "announcements") {
    scopedItem.schoolCode = schoolCode;
  }

  return scopedItem;
}

function enforceEntityScope(entity: ScopedEntity, items: any[], session: any, state: BackOfficeStatePayload) {
  const establishmentRoles = new Set(["school_admin", "principal", "prefet", "secretary"]);
  if (!establishmentRoles.has(String(session?.role ?? ""))) {
    return items;
  }

  const schoolCode = getSessionSchoolCode(session);
  if (!schoolCode) {
    return [];
  }

  const scopedItems = items.map((item) => applyItemScope(entity, item, session, state));
  return scopedItems.filter((item) => itemBelongsToSchool(entity, item, schoolCode, state));
}

function entityNeedsSchoolCode(entity: ScopedEntity) {
  return ["students", "teachers", "classes", "courses", "assignments", "payments", "paymentStatuses", "users", "announcements", "messages", "presences", "notes"].includes(entity);
}

function itemBelongsToSchool(entity: ScopedEntity, item: any, schoolCode: string, state: BackOfficeStatePayload) {
  if (!item) return false;
  if (entity === "schools") return item.code === schoolCode;

  if (entity === "payments" || entity === "presences" || entity === "notes") {
    const student = findStudentForScopedItem(item, state) as any;
    return Boolean(student) && student.schoolCode === schoolCode;
  }

  if (entity === "messages" && item.studentId) {
    const student = findStudentForScopedItem(item, state) as any;
    return Boolean(student) && student.schoolCode === schoolCode;
  }

  if (rowInSchool(item, schoolCode)) return true;

  if (entity === "assignments") {
    const classes = Array.isArray(state.classes) ? state.classes : [];
    const teachers = Array.isArray(state.teachers) ? state.teachers : [];
    const matchingClass = classes.find((schoolClass: any) => schoolClass.name === item.className);
    const matchingTeacher = teachers.find((teacher: any) => teacher.id === item.teacherId || teacher.publicId === item.teacherId);
    return (!matchingClass || rowInSchool(matchingClass, schoolCode)) && (!matchingTeacher || rowInSchool(matchingTeacher, schoolCode));
  }

  return true;
}

function findStudentForScopedItem(item: any, state: BackOfficeStatePayload) {
  const students = Array.isArray(state.students) ? state.students : [];
  return students.find((student: any) => student.id === item.studentId || student.publicId === item.studentId || student.matricule === item.studentId);
}

function filterRows(value: unknown, predicate: (item: any) => boolean) {
  return Array.isArray(value) ? value.filter((item) => predicate(item ?? {})) : [];
}

function rowInSchool(item: any, schoolCode: string) {
  return item?.schoolCode === schoolCode || item?.code === schoolCode || item?.publicId === schoolCode;
}

function filterAcademicConfigs(value: unknown, schoolCode: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const config = (value as Record<string, AcademicManagementConfig>)[schoolCode];
  return config ? { [schoolCode]: config } : {};
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((item) => values.has(item));
}

export function useAdminData() {
  const context = useContext(AdminDataContext);

  if (!context) {
    throw new Error("useAdminData doit etre utilise dans AdminDataProvider");
  }

  return context;
}
