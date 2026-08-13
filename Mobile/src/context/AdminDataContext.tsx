import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Announcement,
  AcademicManagementConfig,
  CountryProfile,
  Course,
  CourseScheduleSlot,
  DEFAULT_CLASS_NAMES,
  DEFAULT_LEVELS,
  DEFAULT_SUBJECTS,
  DEFAULT_TRACKS,
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
import { enrichSessionPermissions } from "../domain/security/permissions";
import {
  ALL_SCHOOLS_CODE,
  pickInitialSchoolCode,
  userRequiresSchoolSelection,
  writeStoredSchoolCode,
} from "../lib/activeSchool";
import { normalize } from "../lib/format";
import { scopeBackOfficeForSession, scopedSchools, type PlatformNotification } from "../lib/scope";
import { getAcademicConfig, getAssignments, getBackOfficeState, getClasses, getCourses, getCourseSchedules, getNotes, getPresences, getStudents, saveBackOfficeState, BackOfficeStatePayload } from "../services/api";
import { SYNC_INTERVAL_MS } from "../config/env";
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
  courseSchedulesData: CourseScheduleSlot[];
  paymentsData: PaymentItem[];
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
  updateNotifications: (items: PlatformNotification[]) => void;
};

const AdminDataContext = createContext<AdminDataContextValue | undefined>(undefined);

const emptyAcademicConfig: AcademicManagementConfig = {
  schoolCode: "",
  periodMode: "trimestre",
  periods: [],
  evaluationTypes: [],
  defaultScale: 20,
  reportCardMode: "period",
  levels: DEFAULT_LEVELS,
  tracks: DEFAULT_TRACKS,
  classNames: DEFAULT_CLASS_NAMES,
  subjects: DEFAULT_SUBJECTS,
};

export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuth();
  const [studentsData, setStudentsData] = useState<Student[]>([]);
  const [teachersData, setTeachersData] = useState<Teacher[]>([]);
  const [classesData, setClassesData] = useState<SchoolClass[]>([]);
  const [countriesData, setCountriesData] = useState<CountryProfile[]>([]);
  const [coursesData, setCoursesData] = useState<Course[]>([]);
  const [assignmentsData, setAssignmentsData] = useState<TeacherAssignment[]>([]);
  const [courseSchedulesData, setCourseSchedulesData] = useState<CourseScheduleSlot[]>([]);
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

  const scopeUser = useMemo(
    () =>
      session
        ? {
            role: session.role,
            countryScope: session.user.countryScope ?? session.user.countryCode,
            schoolCode: session.user.schoolCode ?? session.school.code,
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

  useEffect(() => {
    if (!canSyncBackOfficeState(session?.role, session)) {
      return;
    }

    let mounted = true;
    setSyncStatus("syncing");

    const refresh = () => getBackOfficeState()
      .then((payload) => {
        if (!mounted) return;
        applySyncedState(payload);
        setSyncStatus("synced");
      })
      .catch(() => {
        if (!mounted) return;
        setSyncStatus("offline");
      });
    refresh();
    const intervalId = setInterval(refresh, SYNC_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [session, session?.role]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (canSyncBackOfficeState(session.role, session)) {
      return;
    }

    let mounted = true;
    const refresh = () =>
      Promise.all([
        getStudents(),
        getClasses(),
        getCourses(),
        getNotes(),
        getPresences(),
        getAcademicConfig(),
        getAssignments(),
        getCourseSchedules().catch(() => [] as unknown[]),
      ])
        .then(
          ([
            studentPayload,
            classPayload,
            coursePayload,
            notePayload,
            presencePayload,
            academicConfigPayload,
            assignmentPayload,
            courseSchedulePayload,
          ]) => {
        if (mounted) {
          applyArray(studentPayload, setStudentsData);
          applyArray(classPayload, setClassesData);
          applyArray(coursePayload, setCoursesData);
          applyArray(notePayload, setNotesData);
          applyArray(presencePayload, setPresencesData);
          applyArray(assignmentPayload, setAssignmentsData);
          applyArray(courseSchedulePayload, setCourseSchedulesData);
          setAcademicConfigData(academicConfigPayload as AcademicManagementConfig);
          setSyncStatus("synced");
        }
      })
      .catch(() => {
        if (mounted) setSyncStatus("offline");
      });
    refresh();
    const intervalId = setInterval(refresh, SYNC_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [session]);

  const applySyncedState = (payload: BackOfficeStatePayload) => {
    applyArray(payload.students, setStudentsData);
    applyArray(payload.teachers, setTeachersData);
    applyArray(payload.classes, setClassesData);
    applyArray(payload.countries, setCountriesData);
    applyArray(payload.courses, setCoursesData);
    applyArray(payload.assignments, setAssignmentsData);
    applyArray(payload.courseSchedules, setCourseSchedulesData);
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
      if (config) setAcademicConfigData(config);
    }
  };

  const refreshBackOfficeState = useCallback(async () => {
    if (!session) {
      return;
    }

    setSyncStatus("syncing");

    try {
      if (canSyncBackOfficeState(session.role, session)) {
        const payload = await getBackOfficeState();
        applySyncedState(payload);
        setSyncStatus("synced");
        return;
      }

      const [
        studentPayload,
        classPayload,
        coursePayload,
        notePayload,
        presencePayload,
        academicConfigPayload,
        assignmentPayload,
        courseSchedulePayload,
      ] = await Promise.all([
        getStudents(),
        getClasses(),
        getCourses(),
        getNotes(),
        getPresences(),
        getAcademicConfig(),
        getAssignments(),
        getCourseSchedules().catch(() => [] as unknown[]),
      ]);

      applyArray(studentPayload, setStudentsData);
      applyArray(classPayload, setClassesData);
      applyArray(coursePayload, setCoursesData);
      applyArray(notePayload, setNotesData);
      applyArray(presencePayload, setPresencesData);
      applyArray(assignmentPayload, setAssignmentsData);
      applyArray(courseSchedulePayload, setCourseSchedulesData);
      setAcademicConfigData(academicConfigPayload as AcademicManagementConfig);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("offline");
      throw new Error("Synchronisation impossible");
    }
  }, [session, session?.role, activeSchoolCode, session?.user?.schoolCode, session?.school?.code]);

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

    const enriched = enrichSessionPermissions(session, rolePermissionsData);
    if (!enriched) return;

    const currentPermissions = session.permissions ?? session.user.permissions ?? [];
    if (sameStringSet(currentPermissions, enriched.permissions ?? [])) {
      return;
    }

    setSession(enriched);
  }, [rolePermissionsData, session, session?.role]);

  const persistSyncedState = (nextState: BackOfficeStatePayload) => {
    if (!canSyncBackOfficeState(session?.role, session)) {
      return;
    }

    setSyncStatus("syncing");
    saveBackOfficeState(nextState)
      .then(() => setSyncStatus("synced"))
      .catch(() => setSyncStatus("offline"));
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
        persistSyncedState({
          ...state,
          users: nextUsers,
          rolePermissions: nextPermissions,
        });

        return nextPermissions;
      });
    };

    return {
      studentsData: (state.students ?? []) as Student[],
      teachersData: (state.teachers ?? []) as Teacher[],
      classesData: (state.classes ?? []) as SchoolClass[],
      countriesData: (state.countries ?? []) as CountryProfile[],
      coursesData: (state.courses ?? []) as Course[],
      assignmentsData: (state.assignments ?? []) as TeacherAssignment[],
      courseSchedulesData,
      paymentsData: (state.payments ?? []) as PaymentItem[],
      subscriptionsData: (state.subscriptions ?? []) as SubscriptionItem[],
      paymentStatusesData: (state.paymentStatuses ?? []) as PaymentStatus[],
      presencesData: (state.presences ?? []) as PresenceItem[],
      notesData: (state.notes ?? []) as NoteItem[],
      schoolsData: (state.schools ?? []) as SchoolProfile[],
      usersData: (state.users ?? []) as UserAccount[],
      announcementsData: (state.announcements ?? []) as Announcement[],
      messagesData: (state.messages ?? []) as SchoolMessage[],
      notificationsData: (state.notifications ?? []) as PlatformNotification[],
      rolePermissionsData,
      academicConfigData,
      activeSchoolCode,
      availableSchools,
      requiresSchoolSelection,
      setActiveSchoolCode,
      syncStatus,
      refreshBackOfficeState,
      getItems: (entity) => state[entity],
      createItem: (entity, item) => {
        if (["classes", "schools", "students", "teachers", "assignments"].includes(entity)) return;
        commitEntity(entity, (items) => [applyItemScope(entity, item, session, state), ...items]);
      },
      updateItem: (entity, item) => {
        if (["classes", "schools", "students", "teachers", "assignments"].includes(entity)) return;
        commitEntity(entity, (items) => items.map((row) => (row.id === item.id ? applyItemScope(entity, item, session, state) : row)));
      },
      deleteItem: (entity, id) => {
        if (["classes", "schools", "students", "teachers", "assignments"].includes(entity)) return;
        commitEntity(entity, (items) => items.filter((row) => row.id !== id));
      },
      upsertPresenceItems: (items) =>
        setPresencesData((current) => {
          const scopedItems = items.map((item) => applyItemScope("presences", item, session, state));
          const keys = new Set(scopedItems.map((item) => `${item.studentId}-${item.date}`));
          const nextItems = enforceEntityScope(
            "presences",
            [...scopedItems, ...current.filter((item) => !keys.has(`${item.studentId}-${item.date}`))],
            session,
            state
          );
          persistSyncedState({ ...state, presences: nextItems });
          return nextItems;
        }),
      upsertNoteItem: (item) =>
        setNotesData((current) => {
          const scopedItem = applyItemScope("notes", item, session, state);
          const exists = current.some((row) => row.id === scopedItem.id);
          const nextItems = enforceEntityScope(
            "notes",
            exists ? current.map((row) => (row.id === scopedItem.id ? scopedItem : row)) : [scopedItem, ...current],
            session,
            state
          );
          persistSyncedState({ ...state, notes: nextItems });
          return nextItems;
        }),
      updateRoleFeatureAccess,
      upsertNotification: (item) => {
        setNotificationsData((current) => {
          const next = [item, ...current.filter((row) => row.id !== item.id)];
          persistSyncedState({ ...stateSnapshot, notifications: next });
          return next;
        });
      },
      updateNotifications: (items) => {
        setNotificationsData(items);
        persistSyncedState({ ...stateSnapshot, notifications: items });
      },
    };
  }, [
    announcementsData,
    academicConfigData,
    assignmentsData,
    classesData,
    countriesData,
    coursesData,
    courseSchedulesData,
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
    session?.school.code,
    session?.user.schoolCode,
    scopedStateSnapshot,
    stateSnapshot,
    syncStatus,
    refreshBackOfficeState,
  ]);

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

function canSyncBackOfficeState(role?: string, authenticated?: unknown) {
  if (!authenticated) return false;
  return ["super_admin", "country_admin", "school_admin", "principal", "prefet", "secretary"].includes(role ?? "");
}

function applyArray<T>(value: unknown, setter: React.Dispatch<React.SetStateAction<T[]>>) {
  if (Array.isArray(value)) {
    setter(value as T[]);
  }
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
