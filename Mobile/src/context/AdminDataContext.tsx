import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  pickInitialSchoolCode,
  userRequiresSchoolSelection,
  writeStoredSchoolCode,
} from "../lib/activeSchool";
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
  getCanonicalMessages,
  getCanonicalTeachers,
  getCanonicalUsers,
  type CanonicalAnnouncement,
  type CanonicalSchoolMessage,
  type CanonicalTeacher,
  type CanonicalUserAccount,
} from "../services/domainHydrationApi";
import { snapshotFromFailure, snapshotFromSuccess, type ResourceSnapshot } from "../lib/dataTruth";
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
  loadPresences: () => Promise<void>;
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
  };

  const requiresSchoolSelection = userRequiresSchoolSelection(scopeUser);

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
      setSyncStatus("offline");
      throw new Error("Synchronisation impossible");
    }
  }, [session]);

  const loadPayments = useCallback(async () => {
    if (!session) return;
    setPaymentsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getPayments()) as PaymentItem[];
      setPaymentsData(rows);
      setPaymentsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setPaymentsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadUsers = useCallback(async () => {
    if (!session) return;
    setUsersSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalUsers();
      setUsersData(rows);
      setUsersSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setUsersSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadTeachers = useCallback(async () => {
    if (!session) return;
    setTeachersSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalTeachers();
      setTeachersData(rows);
      setTeachersSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setTeachersSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadStudents = useCallback(async () => {
    if (!session) return;
    setStudentsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getStudents()) as Student[];
      setStudentsData(rows);
      setStudentsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setStudentsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadClasses = useCallback(async () => {
    if (!session) return;
    setClassesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getClasses()) as SchoolClass[];
      setClassesData(rows);
      setClassesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setClassesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadAnnouncements = useCallback(async () => {
    if (!session) return;
    setAnnouncementsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalAnnouncements();
      setAnnouncementsData(rows);
      setAnnouncementsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setAnnouncementsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadMessages = useCallback(async () => {
    if (!session) return;
    setMessagesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCanonicalMessages();
      setMessagesData(rows);
      setMessagesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setMessagesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadPlanningWeekly = useCallback(async () => {
    if (!session) return;
    setCourseSchedulesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getPlanningWeekly();
      setCourseSchedulesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setCourseSchedulesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadPlanningCourseOptions = useCallback(async () => {
    if (!session) return;
    setPlanningCourseOptionsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getPlanningCourseOptions();
      setPlanningCourseOptionsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setPlanningCourseOptionsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadRooms = useCallback(async () => {
    if (!session) return;
    setRoomsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getSchoolRooms();
      setRoomsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setRoomsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadReplacements = useCallback(async () => {
    if (!session) return;
    setReplacementsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getCourseScheduleReplacements();
      setReplacementsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setReplacementsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadReportCards = useCallback(async () => {
    if (!session) return;
    setReportCardsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getReportCards();
      setReportCardsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setReportCardsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadEvaluations = useCallback(async () => {
    if (!session) return;
    setEvaluationsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getEvaluations();
      setEvaluationsSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setEvaluationsSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadEvaluation = useCallback(
    async (evaluationId: string) => {
      const key = String(evaluationId ?? "").trim();
      if (!session || !key) return null;
      setEvaluationsSnapshot((current) => ({ ...current, status: "loading" }));
      try {
        const rows = await getEvaluations();
        setEvaluationsSnapshot(snapshotFromSuccess(rows));
        return (
          rows.find(
            (row) =>
              row.evaluationId === key || row.id === key || row.pgId === key || String(row.publicId ?? "") === key,
          ) ?? null
        );
      } catch (error) {
        setEvaluationsSnapshot((current) => snapshotFromFailure(error, current.data));
        throw error;
      }
    },
    [session],
  );

  const loadNotes = useCallback(async () => {
    if (!session) return;
    setNotesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await getNotes();
      setNotesSnapshot(snapshotFromSuccess(rows));
      setNotesData(rows.map(canonicalGradeToNoteItem));
    } catch (error) {
      setNotesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadPresences = useCallback(async () => {
    if (!session) return;
    setPresencesSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = (await getPresences()) as PresenceItem[];
      applyArray(rows, setPresencesData);
      setPresencesSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      setPresencesSnapshot((current) => snapshotFromFailure(error, current.data));
    }
  }, [session]);

  const loadEvaluationGrades = useCallback(
    async (evaluationId: string) => {
      if (!session) return [];
      setNotesSnapshot((current) => ({ ...current, status: "loading" }));
      try {
        const rows = await getNotes();
        setNotesSnapshot(snapshotFromSuccess(rows));
        setNotesData(rows.map(canonicalGradeToNoteItem));
        return gradesForEvaluation(rows, evaluationId);
      } catch (error) {
        setNotesSnapshot((current) => snapshotFromFailure(error, current.data));
        throw error;
      }
    },
    [session],
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    void refreshBackOfficeState().catch(() => null);
  }, [session, refreshBackOfficeState]);

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
      studentsData: (studentsSnapshot.status === "idle" ? state.students ?? [] : studentsSnapshot.data) as Student[],
      teachersData: (teachersSnapshot.status === "idle" ? state.teachers ?? [] : teachersSnapshot.data) as Teacher[],
      classesData: (classesSnapshot.status === "idle" ? state.classes ?? [] : classesSnapshot.data) as SchoolClass[],
      countriesData: (state.countries ?? []) as CountryProfile[],
      coursesData: (state.courses ?? []) as Course[],
      assignmentsData: (state.assignments ?? []) as TeacherAssignment[],
      courseSchedulesData: courseSchedulesSnapshot.data,
      paymentsData: paymentsSnapshot.data as PaymentItem[],
      paymentsSnapshot,
      usersSnapshot,
      teachersSnapshot,
      studentsSnapshot,
      classesSnapshot,
      presencesSnapshot,
      announcementsSnapshot,
      messagesSnapshot,
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
      subscriptionsData: (state.subscriptions ?? []) as SubscriptionItem[],
      paymentStatusesData: (state.paymentStatuses ?? []) as PaymentStatus[],
      presencesData: (presencesSnapshot.status === "idle" ? state.presences ?? [] : presencesSnapshot.data) as PresenceItem[],
      notesData: (state.notes ?? []) as NoteItem[],
      schoolsData: (state.schools ?? []) as SchoolProfile[],
      usersData: (usersSnapshot.status === "idle" ? state.users ?? [] : usersSnapshot.data) as UserAccount[],
      announcementsData: (announcementsSnapshot.status === "idle" ? state.announcements ?? [] : announcementsSnapshot.data) as Announcement[],
      messagesData: (messagesSnapshot.status === "idle" ? state.messages ?? [] : messagesSnapshot.data) as SchoolMessage[],
      notificationsData: (state.notifications ?? []) as PlatformNotification[],
      rolePermissionsData,
      academicConfigData,
      activeSchoolCode,
      availableSchools,
      requiresSchoolSelection,
      setActiveSchoolCode,
      syncStatus,
      refreshBackOfficeState,
      getItems: (entity) => {
        if (entity === "users") return usersSnapshot.status === "idle" ? state.users : usersSnapshot.data;
        if (entity === "teachers") return teachersSnapshot.status === "idle" ? state.teachers : teachersSnapshot.data;
        if (entity === "students") return studentsSnapshot.status === "idle" ? state.students : studentsSnapshot.data;
        if (entity === "classes") return classesSnapshot.status === "idle" ? state.classes : classesSnapshot.data;
        if (entity === "payments") return paymentsSnapshot.data;
        if (entity === "announcements") {
          return announcementsSnapshot.status === "idle" ? state.announcements : announcementsSnapshot.data;
        }
        if (entity === "messages") return messagesSnapshot.status === "idle" ? state.messages : messagesSnapshot.data;
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
    loadPayments,
    loadUsers,
    loadTeachers,
    loadStudents,
    loadClasses,
    loadAnnouncements,
    loadMessages,
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
