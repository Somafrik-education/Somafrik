import type { L1Resource } from "./types";

export const L1_TABLE_BY_RESOURCE: Record<L1Resource, string> = {
  classes: "l1_classes",
  students: "l1_students",
  assignments: "l1_assignments",
  "school-courses": "l1_school_courses",
  "course-schedules": "l1_course_schedules",
};

/** Colonnes métier = DTO L1 serveur (snake_case SQLite). Jamais de secrets ni de noms dénormalisés d'autres ressources. */
export const L1_RESOURCE_COLUMNS: Record<L1Resource, readonly string[]> = {
  classes: [
    "id",
    "class_code",
    "name",
    "academic_year_id",
    "level_id",
    "stream_id",
    "group_id",
    "status",
    "updated_at",
  ],
  students: [
    "id",
    "student_code",
    "first_name",
    "last_name",
    "class_id",
    "class_code",
    "enrollment_id",
    "enrollment_status",
    "academic_year_id",
    "status",
    "sync_updated_at",
  ],
  assignments: [
    "id",
    "teacher_id",
    "teacher_code",
    "teacher_user_id",
    "class_id",
    "class_code",
    "subject_id",
    "subject_code",
    "academic_year_id",
    "assignment_role",
    "status",
    "updated_at",
  ],
  "school-courses": [
    "id",
    "course_code",
    "class_id",
    "class_code",
    "subject_id",
    "subject_code",
    "teacher_id",
    "teacher_code",
    "academic_year_id",
    "coefficient",
    "status",
    "updated_at",
  ],
  "course-schedules": [
    "id",
    "school_course_id",
    "course_code",
    "academic_year_id",
    "class_id",
    "class_code",
    "subject_id",
    "subject_code",
    "teacher_id",
    "teacher_code",
    "room_id",
    "room_code",
    "day_of_week",
    "start_time",
    "end_time",
    "status",
    "updated_at",
  ],
};

export const L1_DTO_TO_COLUMN: Record<string, string> = {
  id: "id",
  classCode: "class_code",
  name: "name",
  academicYearId: "academic_year_id",
  levelId: "level_id",
  streamId: "stream_id",
  groupId: "group_id",
  status: "status",
  updatedAt: "updated_at",
  studentCode: "student_code",
  firstName: "first_name",
  lastName: "last_name",
  classId: "class_id",
  enrollmentId: "enrollment_id",
  enrollmentStatus: "enrollment_status",
  syncUpdatedAt: "sync_updated_at",
  teacherId: "teacher_id",
  teacherCode: "teacher_code",
  teacherUserId: "teacher_user_id",
  subjectId: "subject_id",
  subjectCode: "subject_code",
  assignmentRole: "assignment_role",
  courseCode: "course_code",
  coefficient: "coefficient",
  schoolCourseId: "school_course_id",
  roomId: "room_id",
  roomCode: "room_code",
  dayOfWeek: "day_of_week",
  startTime: "start_time",
  endTime: "end_time",
};

export const FORBIDDEN_L1_COLUMNS = [
  "access_token",
  "refresh_token",
  "password",
  "pin",
  "parent_phone",
  "parent_email",
  "documents",
  "photo",
  "backoffice_state",
  "scope_version",
] as const;

export const SCHEMA_MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS l1_sync_meta (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  resource TEXT NOT NULL,
  cursor TEXT,
  scope_hash TEXT,
  state TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  last_success_at TEXT,
  PRIMARY KEY (user_id, school_id, resource)
);

CREATE TABLE IF NOT EXISTS l1_classes (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  id TEXT NOT NULL,
  class_code TEXT,
  name TEXT,
  academic_year_id TEXT,
  level_id TEXT,
  stream_id TEXT,
  group_id TEXT,
  status TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, school_id, id)
);

CREATE TABLE IF NOT EXISTS l1_students (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  id TEXT NOT NULL,
  student_code TEXT,
  first_name TEXT,
  last_name TEXT,
  class_id TEXT,
  class_code TEXT,
  enrollment_id TEXT,
  enrollment_status TEXT,
  academic_year_id TEXT,
  status TEXT,
  sync_updated_at TEXT,
  PRIMARY KEY (user_id, school_id, id)
);

CREATE TABLE IF NOT EXISTS l1_assignments (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  id TEXT NOT NULL,
  teacher_id TEXT,
  teacher_code TEXT,
  teacher_user_id TEXT,
  class_id TEXT,
  class_code TEXT,
  subject_id TEXT,
  subject_code TEXT,
  academic_year_id TEXT,
  assignment_role TEXT,
  status TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, school_id, id)
);

CREATE TABLE IF NOT EXISTS l1_school_courses (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  id TEXT NOT NULL,
  course_code TEXT,
  class_id TEXT,
  class_code TEXT,
  subject_id TEXT,
  subject_code TEXT,
  teacher_id TEXT,
  teacher_code TEXT,
  academic_year_id TEXT,
  coefficient TEXT,
  status TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, school_id, id)
);

CREATE TABLE IF NOT EXISTS l1_course_schedules (
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  school_code TEXT,
  id TEXT NOT NULL,
  school_course_id TEXT,
  course_code TEXT,
  academic_year_id TEXT,
  class_id TEXT,
  class_code TEXT,
  subject_id TEXT,
  subject_code TEXT,
  teacher_id TEXT,
  teacher_code TEXT,
  room_id TEXT,
  room_code TEXT,
  day_of_week INTEGER,
  start_time TEXT,
  end_time TEXT,
  status TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, school_id, id)
);

CREATE INDEX IF NOT EXISTS idx_l1_classes_user_school ON l1_classes (user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_l1_students_user_school ON l1_students (user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_l1_students_class ON l1_students (user_id, school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_l1_assignments_user_school ON l1_assignments (user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_l1_assignments_teacher ON l1_assignments (user_id, school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_l1_assignments_class ON l1_assignments (user_id, school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_l1_school_courses_user_school ON l1_school_courses (user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_l1_school_courses_class ON l1_school_courses (user_id, school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_l1_course_schedules_user_school ON l1_course_schedules (user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_l1_course_schedules_class ON l1_course_schedules (user_id, school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_l1_course_schedules_teacher ON l1_course_schedules (user_id, school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_l1_sync_meta_user_school ON l1_sync_meta (user_id, school_id);
`;
