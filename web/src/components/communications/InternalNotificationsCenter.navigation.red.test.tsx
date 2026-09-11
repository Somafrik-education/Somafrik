/**
 * Lot R1 (RED) — navigation du bouton « Ouvrir » de l'inbox C4.
 *
 * Contrat visé : ouvrir une notification doit conduire à LA ressource concernée,
 * pas à une page de liste générique. L'identifiant porté par `navigationTarget`
 * doit donc arriver jusqu'à la destination.
 *
 * État actuel (develop@7bcca23a) : `openNotification()` ne reconnaît que
 * `conversation`, `announcement` et `payment`, navigue vers `/messages`,
 * `/annonces` et `/paiements` sans identifiant, et ignore les six autres cibles.
 * Ces tests échouent donc aujourd'hui, par conception.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { navigateSpy, listSpy, markReadSpy, archiveSpy, notifySpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  listSpy: vi.fn(),
  markReadSpy: vi.fn(),
  archiveSpy: vi.fn(),
  notifySpy: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "SCH-001" }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canCreate: false }),
  usePermissionContext: () => ({ user: null, rolePermissions: {} }),
}));

vi.mock("../../lib/internalNotificationsApi", () => ({
  internalNotificationsApi: {
    list: (...args: unknown[]) => listSpy(...args),
    markRead: (...args: unknown[]) => markReadSpy(...args),
    archive: (...args: unknown[]) => archiveSpy(...args),
    downloadAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/internalNotificationsRead", () => ({
  notifyInternalNotificationsChanged: () => notifySpy(),
}));

vi.mock("../ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { InternalNotificationsCenter } from "./InternalNotificationsCenter";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const ANNOUNCEMENT_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const ATTENDANCE_ID = "44444444-4444-4444-8444-444444444444";
const GRADE_ID = "55555555-5555-4555-8555-555555555555";
const REPORT_CARD_ID = "66666666-6666-4666-8666-666666666666";
const OBLIGATION_ID = "77777777-7777-4777-8777-777777777777";
const WEEKLY_SLOT_ID = "88888888-8888-4888-8888-888888888888";
const REPLACEMENT_ID = "99999999-9999-4999-8999-999999999999";
const STUDENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type NavigationTarget = Record<string, unknown>;

function notification(eventType: string, navigationTarget: NavigationTarget, readAt = "2026-09-09T08:00:00.000Z") {
  return {
    type: "notification" as const,
    id: `note-${String(navigationTarget.type ?? "none")}`,
    schoolCode: "SCH-001",
    eventType,
    sourceEntityType: "entity",
    sourceEntityId: "source-1",
    senderType: "system" as const,
    senderUserId: null,
    senderName: "Somafrik",
    title: `Notification ${String(navigationTarget.type ?? "none")}`,
    body: "corps",
    createdAt: "2026-09-09T07:00:00.000Z",
    publishedAt: "2026-09-09T07:00:00.000Z",
    readAt,
    archivedAt: "",
    status: readAt ? "Lu" : "Non lu",
    attachments: [],
    navigationTarget,
    metadataSafe: {},
  };
}

/** Représentation textuelle de la cible passée à `navigate()`, quelle que soit sa forme. */
function navigatedTo(): string {
  expect(navigateSpy, "navigate() n'a pas été appelé : le bouton Ouvrir est sans effet").toHaveBeenCalled();
  const [to] = navigateSpy.mock.calls.at(-1) as [unknown];
  if (typeof to === "string") return to;
  if (to && typeof to === "object") {
    const record = to as { pathname?: string; search?: string; hash?: string };
    return `${record.pathname ?? ""}${record.search ?? ""}${record.hash ?? ""}`;
  }
  return String(to);
}

async function openFirstNotification() {
  const expand = await screen.findByRole("button", { name: /Afficher les détails/ });
  await userEvent.click(expand);
  const button = await screen.findByRole("button", { name: /Ouvrir|Lire/ });
  await userEvent.click(button);
}

/**
 * Table de contrat : pour chaque cible produite par le backend, la route de
 * destination attendue et l'identifiant qui doit impérativement y figurer.
 * Les routes correspondent à des routes réellement déclarées dans `App.tsx`.
 */
const NAVIGATION_CONTRACT = [
  {
    label: "conversation",
    eventType: "communication.message.created",
    target: { type: "conversation", conversationId: CONVERSATION_ID },
    routes: ["/messages"],
    requiredIds: [CONVERSATION_ID],
  },
  {
    label: "announcement",
    eventType: "communication.announcement.published",
    target: { type: "announcement", announcementId: ANNOUNCEMENT_ID },
    routes: ["/annonces"],
    requiredIds: [ANNOUNCEMENT_ID],
  },
  {
    label: "payment",
    eventType: "finance.payment.recorded",
    target: { type: "payment", studentId: STUDENT_ID, paymentId: PAYMENT_ID },
    // `/paiements` est un alias qui redirige vers `/finances/paiements` : les deux conviennent.
    routes: ["/finances", "/paiements"],
    requiredIds: [PAYMENT_ID],
  },
  {
    label: "attendance",
    eventType: "attendance.student.absent",
    target: { type: "attendance", studentId: STUDENT_ID, attendanceId: ATTENDANCE_ID },
    routes: ["/presences"],
    requiredIds: [ATTENDANCE_ID],
  },
  {
    label: "grade",
    eventType: "pedagogy.grade.published",
    target: { type: "grade", studentId: STUDENT_ID, gradeId: GRADE_ID },
    routes: ["/notes"],
    requiredIds: [GRADE_ID],
  },
  {
    label: "report_card",
    eventType: "pedagogy.report_card.published",
    target: { type: "report_card", studentId: STUDENT_ID, reportCardId: REPORT_CARD_ID },
    routes: ["/bulletins"],
    requiredIds: [REPORT_CARD_ID],
  },
  {
    label: "finance_obligation",
    eventType: "finance.payment.due",
    target: { type: "finance_obligation", studentId: STUDENT_ID, obligationId: OBLIGATION_ID },
    routes: ["/finances", "/paiements"],
    requiredIds: [OBLIGATION_ID],
  },
  {
    label: "timetable (planning)",
    eventType: "planning.timetable.changed",
    target: { type: "timetable", weeklySlotId: WEEKLY_SLOT_ID, classId: "cls-1" },
    routes: ["/planning"],
    requiredIds: [WEEKLY_SLOT_ID],
  },
  {
    label: "teacher_replacement",
    eventType: "planning.teacher.replacement",
    target: { type: "teacher_replacement", replacementId: REPLACEMENT_ID, classId: "cls-1", occurrenceDate: "2026-09-15" },
    routes: ["/planning"],
    requiredIds: [REPLACEMENT_ID],
  },
] as const;

describe("RED-N1 — bouton Ouvrir : navigation vers la ressource concernée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markReadSpy.mockImplementation(async () => notification("x", {}, "2026-09-09T08:00:00.000Z"));
    archiveSpy.mockResolvedValue({ id: "x", archivedAt: "2026-09-09T09:00:00.000Z" });
  });

  for (const entry of NAVIGATION_CONTRACT) {
    it(`RED-N1-${entry.label} — ouvre ${entry.routes[0]} en transmettant l'identifiant`, async () => {
      listSpy.mockResolvedValue({ items: [notification(entry.eventType, entry.target)], nextCursor: null });
      render(<InternalNotificationsCenter />);
      await openFirstNotification();

      await waitFor(() => {
        expect(
          navigateSpy,
          `cible « ${entry.label} » : aucune navigation déclenchée par Ouvrir`,
        ).toHaveBeenCalled();
      });

      const destination = navigatedTo();
      expect(
        entry.routes.some((route) => destination.includes(route)),
        `cible « ${entry.label} » : destination « ${destination} » hors des routes attendues ${entry.routes.join(" ou ")}`,
      ).toBe(true);
      for (const id of entry.requiredIds) {
        expect(
          destination,
          `cible « ${entry.label} » : l'identifiant ${id} doit être transmis à la destination, or la navigation vaut « ${destination} »`,
        ).toContain(id);
      }
    });
  }

  it("RED-N1-couverture — aucune cible connue ne doit rester sans navigation", async () => {
    const items = NAVIGATION_CONTRACT.map((entry) => notification(entry.eventType, entry.target));
    listSpy.mockResolvedValue({ items, nextCursor: null });
    render(<InternalNotificationsCenter />);

    const summaries = await screen.findAllByRole("button", { name: /Afficher les détails/ });
    for (const summary of summaries) {
      await userEvent.click(summary);
    }
    const buttons = await screen.findAllByRole("button", { name: /Ouvrir|Lire/ });
    expect(buttons).toHaveLength(NAVIGATION_CONTRACT.length);

    const withoutNavigation: string[] = [];
    for (const [index, entry] of NAVIGATION_CONTRACT.entries()) {
      navigateSpy.mockClear();
      await userEvent.click(buttons[index]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!navigateSpy.mock.calls.length) withoutNavigation.push(entry.label);
    }

    expect(
      withoutNavigation,
      `cibles ouvrables sans aucune navigation : ${withoutNavigation.join(", ") || "aucune"}`,
    ).toEqual([]);
  });

  it("RED-N1-lecture — ouvrir une notification déjà lue navigue quand même vers la ressource", async () => {
    const entry = NAVIGATION_CONTRACT[0];
    listSpy.mockResolvedValue({
      items: [notification(entry.eventType, entry.target, "2026-09-09T08:00:00.000Z")],
      nextCursor: null,
    });
    render(<InternalNotificationsCenter />);
    expect(await screen.findByRole("button", { name: /Ouvrir|Afficher les détails/ })).toBeTruthy();
    await openFirstNotification();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(markReadSpy, "une notification déjà lue ne doit pas être re-marquée lue").not.toHaveBeenCalled();
    expect(navigatedTo()).toContain(CONVERSATION_ID);
  });

  it("RED-N1-non-lue — lire une notification non lue la marque lue ET navigue vers la ressource", async () => {
    const entry = NAVIGATION_CONTRACT[1];
    const unread = notification(entry.eventType, entry.target, "");
    listSpy.mockResolvedValue({ items: [unread], nextCursor: null });
    markReadSpy.mockResolvedValue({ ...unread, readAt: "2026-09-09T10:00:00.000Z", status: "Lu" });
    render(<InternalNotificationsCenter />);

    expect(await screen.findByRole("button", { name: /Lire|Afficher les détails/ })).toBeTruthy();
    await openFirstNotification();

    await waitFor(() => expect(markReadSpy).toHaveBeenCalledWith(unread.id, "SCH-001"));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(navigatedTo()).toContain(ANNOUNCEMENT_ID);
  });
});
