import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Announcement,
  AcademicManagementConfig,
  CountryProfile,
  Course,
  CourseScheduleSlot,
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
import { getAcademicConfig, getAssignments, getClasses, getCourses, getCourseSchedules, getNotes, getPresences, getStudents, getSubjects, createPlatformNotification, updatePlatformNotification, getEffectivePermissions, createClientsAnnouncement, updateClientsAnnouncement, sendClientsMessage, createClientsUser, updateClientsUser, BackOfficeStatePayload } from "../services/api";
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
        courseSchedulePayload,
        subjectPayload,
      ] = await Promise.all([
        getStudents(),
        getClasses(),
        getCourses(),
        getNotes(),
        getPresences(),
        getAcademicConfig(),
        getAssignments(),
        getCourseSchedules().catch(() => [] as unknown[]),
        getSubjects(),
      ]);

      applyArray(studentPayload, setStudentsData);
      applyArray(classPayload, setClassesData);
      applyArray(coursePayload, setCoursesData);
      applyArray(notePayload, setNotesData);
      applyArray(presencePayload, setPresencesData);
      applyArray(assignmentPayload, setAssignmentsData);
      applyArray(courseSchedulePayload, setCourseSchedulesData);
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
        if (
          entity === "classes" || entity === "schools" || entity === "students" ||
          entity === "teachers" || entity === "assignments" ||
          entity === "payments" || entity === "paymentStatuses" ||
          entity === "courses"
        ) return;
        if (entity === "announcements") {
          void createClientsAnnouncement(item as Record<string, unknown>)
            .then((created) => setAnnouncementsData((current) => [created as Announcement, ...current]))
            .catch(() => setSyncStatus("offline"));
          return;
        }
        if (entity === "messages") {
          void sendClientsMessage(item as Record<string, unknown>)
            .then((created) => setMessagesData((current) => [created as SchoolMessage, ...current]))
            .catch(() => setSyncStatus("offline"));
          return;
        }
        if (entity === "users") {
          void createClientsUser(item as Record<string, unknown>)
            .then((created) => setUsersData((current) => [created as UserAccount, ...current]))
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
      upsertPresenceItems: (items) =>
        setPresencesData((current) => {
          const scopedItems = items.map((item) => applyItemScope("presences", item, session, state));
          const keys = new Set(scopedItems.map((item) => `${item.studentId}-${item.date}`));
          return enforceEntityScope(
            "presences",
            [...scopedItems, ...current.filter((item) => !keys.has(`${item.studentId}-${item.date}`))],
            session,
            state,
          );
        }),
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
