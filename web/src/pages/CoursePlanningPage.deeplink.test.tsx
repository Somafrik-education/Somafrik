/**
 * DEEPLINK-PLANNING — `/planning/emploi-du-temps/calendrier?weeklySlotId=…`
 * doit ouvrir le créneau hebdomadaire visé, pas seulement le calendrier.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const showToast = vi.hoisted(() => vi.fn());
const scopedSlots = vi.hoisted(() => vi.fn());
const listOccurrences = vi.hoisted(() => vi.fn());
const listCourseOptions = vi.hoisted(() => vi.fn());
const roomsList = vi.hoisted(() => vi.fn());

const SLOTS = [
  {
    id: "slot-1",
    schoolCode: "SCH-001",
    className: "6e A",
    subject: "Mathématiques",
    schoolCourseId: "course-1",
    academicYearId: "year-1",
    teacherId: "t-1",
    teacherName: "Mme Kabila",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:00",
    status: "active",
  },
  {
    id: "slot-2",
    schoolCode: "SCH-001",
    className: "5e B",
    subject: "Histoire",
    schoolCourseId: "course-2",
    academicYearId: "year-1",
    teacherId: "t-2",
    teacherName: "M. Ilunga",
    dayOfWeek: 3,
    startTime: "10:00",
    endTime: "11:00",
    status: "active",
  },
];

const dataState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "u1", role: "Admin School", schoolCode: "SCH-001" } } }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({ state: dataState.current, update: vi.fn(), refresh: vi.fn(async () => undefined) }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    scopedUser: { id: "u1", role: "Admin School", schoolCode: "SCH-001" },
    activeSchool: { id: "school-1", code: "SCH-001", name: "École test" },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({}),
  useFeaturePermissions: () => ({ canRead: true, canCreate: true, canUpdate: true, canDelete: true }),
}));

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock("../components/ui/PrintButton", () => ({ PrintButton: () => <button type="button">Imprimer</button> }));

vi.mock("../components/planning/CoursePlanningCalendar", () => ({
  CoursePlanningCalendar: () => <div>Calendrier</div>,
}));

vi.mock("../lib/coursePlanning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/coursePlanning")>();
  return { ...actual, scopedCourseSchedules: scopedSlots };
});

vi.mock("../lib/pedagogyApi", () => ({
  pedagogyApi: {
    listCourseScheduleOccurrences: listOccurrences,
    listPlanningCourseOptions: listCourseOptions,
  },
}));

vi.mock("../lib/planningRoomsReplacementsApi", () => ({
  schoolRoomsApi: { list: roomsList },
  replacementsApi: { list: vi.fn(), options: vi.fn(), create: vi.fn(), cancel: vi.fn() },
}));

vi.mock("../lib/pedagogyPlanningSync", () => ({ syncSchoolCourseSchedules: vi.fn() }));

import { CoursePlanningPage } from "./CoursePlanningPage";

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/planning/emploi-du-temps/calendrier${search}`]}>
      <CoursePlanningPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  scopedSlots.mockReturnValue(SLOTS);
  listOccurrences.mockResolvedValue({ items: [] });
  listCourseOptions.mockResolvedValue({ items: [] });
  roomsList.mockResolvedValue({ items: [] });
  dataState.current = {
    schools: [{ id: "school-1", code: "SCH-001", name: "École test" }],
    classes: [
      { id: "11111111-1111-4111-8111-111111111111", name: "6e A", schoolCode: "SCH-001" },
      { id: "22222222-2222-4222-8222-222222222222", name: "5e B", schoolCode: "SCH-001" },
    ],
    students: [],
    teachers: [],
    assignments: [],
    courses: [],
    courseSchedules: SLOTS,
    academicConfigs: {},
    users: [],
  };
});

describe("DEEPLINK-PLANNING — la page Planning consomme weeklySlotId", () => {
  it("DEEPLINK-PLANNING-01 — le créneau visé est ouvert et sa classe sélectionnée", async () => {
    renderPage("?weeklySlotId=slot-2&classId=22222222-2222-4222-8222-222222222222");

    const form = await screen.findByTestId("planning-slot-form");
    expect(form).toHaveAttribute("data-weekly-slot-id", "slot-2");
    await waitFor(() => expect(screen.getAllByDisplayValue("5e B").length).toBeGreaterThan(0));
    expect(form).toHaveTextContent("Modifier le créneau hebdomadaire");
  });

  it("DEEPLINK-PLANNING-02 — sans paramètre, aucun créneau n'est ouvert d'office", async () => {
    renderPage("");
    await screen.findByText("Calendrier");
    expect(screen.queryByTestId("planning-slot-form")).toBeNull();
  });

  it("DEEPLINK-PLANNING-03 — un créneau hors périmètre n'ouvre aucune fiche", async () => {
    renderPage("?weeklySlotId=slot-autre-ecole");
    await screen.findByText("Calendrier");
    expect(screen.queryByTestId("planning-slot-form")).toBeNull();
  });
});
