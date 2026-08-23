/**
 * LOT 6 — contrats UI Android / petits écrans / clavier / accessibilité.
 * Logique pure, testable hors device.
 */

export const MIN_TOUCH_TARGET_DP = 44;
export const SMALL_ANDROID_VIEWPORT = { width: 320, height: 568 } as const;
export const DEFAULT_ANDROID_KEYBOARD_HEIGHT = 260;
export const ICON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export const USABILITY_TEST_IDS = {
  loginKeyboardScroll: "login-keyboard-scroll",
  loginSubmit: "login-submit-button",
  classesSearch: "classes-search-input",
  classesEmptySearch: "classes-empty-search",
  attendanceAction: (studentId: string, status: string) =>
    `attendance-action-${studentId}-${attendanceStatusSlug(status)}`,
  attendanceClass: (className: string) => `attendance-class-${slugify(className)}`,
  attendanceStudent: (studentId: string) => `attendance-student-${studentId}`,
  attendanceCurrentStatus: (studentId: string) => `attendance-current-status-${studentId}`,
  attendanceCurrentStatusValue: (studentId: string, status: string) =>
    `attendance-current-status-${studentId}-${attendanceStatusSlug(status)}`,
  attendanceMarkAllPresent: "attendance-mark-all-present",
  attendanceSave: "attendance-save",
  attendancePresentCount: "attendance-present-count",
  attendanceAbsentCount: "attendance-absent-count",
  attendanceLateCount: "attendance-late-count",
  attendanceRate: "attendance-rate",
  notesGradeInput: (studentId: string) => `notes-grade-input-${slugify(studentId)}`,
  notesSave: "evaluations-v2-save",
  messagesComposer: "messages-composer",
  messagesSend: "messages-send-button",
} as const;

export const ATTENDANCE_ACTIONS = ["Présent", "Absent", "Retard", "Justifié"] as const;
export type AttendanceAction = (typeof ATTENDANCE_ACTIONS)[number];

export type TouchBox = {
  width: number;
  height: number;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
};

export function slugify(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function attendanceStatusSlug(status: string): string {
  const normalized = slugify(status);
  if (normalized === "present" || normalized === "present.") return "present";
  if (normalized === "absent" || normalized === "absence") return "absent";
  if (normalized === "retard" || normalized === "late") return "late";
  if (normalized === "justifie" || normalized === "justifiee" || normalized === "excused") return "excused";
  return normalized;
}

export function effectiveTouchSize(box: TouchBox): { width: number; height: number } {
  const slop = box.hitSlop ?? {};
  return {
    width: box.width + (slop.left ?? 0) + (slop.right ?? 0),
    height: box.height + (slop.top ?? 0) + (slop.bottom ?? 0),
  };
}

export function touchTargetMeetsMinimum(box: TouchBox, minimum = MIN_TOUCH_TARGET_DP): boolean {
  const size = effectiveTouchSize(box);
  return size.width >= minimum && size.height >= minimum;
}

export type KeyboardLayoutInput = {
  viewportHeight: number;
  keyboardHeight: number;
  focusedFieldBottom: number;
  ctaBottom: number;
  errorBottom?: number;
  scrollOffset?: number;
};

export type KeyboardLayoutResult = {
  visibleHeight: number;
  focusedFieldVisible: boolean;
  ctaVisible: boolean;
  errorVisible: boolean;
  needsScroll: boolean;
};

export function keyboardFormLayout(input: KeyboardLayoutInput): KeyboardLayoutResult {
  const scrollOffset = Math.max(0, input.scrollOffset ?? 0);
  const visibleHeight = Math.max(0, input.viewportHeight - input.keyboardHeight);
  const focusedFieldBottom = input.focusedFieldBottom - scrollOffset;
  const ctaBottom = input.ctaBottom - scrollOffset;
  const errorBottom = (input.errorBottom ?? ctaBottom) - scrollOffset;
  const focusedFieldVisible = focusedFieldBottom <= visibleHeight && focusedFieldBottom > 0;
  const ctaVisible = ctaBottom <= visibleHeight && ctaBottom > 0;
  const errorVisible = errorBottom <= visibleHeight && errorBottom > 0;
  return {
    visibleHeight,
    focusedFieldVisible,
    ctaVisible,
    errorVisible,
    needsScroll: !(focusedFieldVisible && ctaVisible && errorVisible),
  };
}

export function loginKeyboardScenario() {
  const viewportHeight = SMALL_ANDROID_VIEWPORT.height;
  const keyboardHeight = DEFAULT_ANDROID_KEYBOARD_HEIGHT;
  const focusedFieldBottom = 430;
  const errorBottom = 478;
  const ctaBottom = 530;
  const withoutScroll = keyboardFormLayout({
    viewportHeight,
    keyboardHeight,
    focusedFieldBottom,
    errorBottom,
    ctaBottom,
  });
  const scrollOffset = Math.max(0, ctaBottom - withoutScroll.visibleHeight + 16);
  const withScroll = keyboardFormLayout({
    viewportHeight,
    keyboardHeight,
    focusedFieldBottom,
    errorBottom,
    ctaBottom,
    scrollOffset,
  });
  return { withoutScroll, withScroll, scrollOffset };
}

export function notesLastStudentKeyboardScenario(rosterSize = 50) {
  const rowHeight = 72;
  const headerHeight = 140;
  const saveButtonHeight = 56;
  const lastFieldBottom = headerHeight + rosterSize * rowHeight;
  const ctaBottom = lastFieldBottom + saveButtonHeight + 12;
  const withoutScroll = keyboardFormLayout({
    viewportHeight: SMALL_ANDROID_VIEWPORT.height,
    keyboardHeight: DEFAULT_ANDROID_KEYBOARD_HEIGHT,
    focusedFieldBottom: lastFieldBottom,
    ctaBottom,
  });
  const scrollOffset = Math.max(0, ctaBottom - withoutScroll.visibleHeight + 24);
  const withScroll = keyboardFormLayout({
    viewportHeight: SMALL_ANDROID_VIEWPORT.height,
    keyboardHeight: DEFAULT_ANDROID_KEYBOARD_HEIGHT,
    focusedFieldBottom: lastFieldBottom,
    ctaBottom,
    scrollOffset,
  });
  return { withoutScroll, withScroll, scrollOffset, lastFieldBottom };
}

export function messagesComposerKeyboardScenario() {
  const focusedFieldBottom = 420;
  const ctaBottom = 500;
  const withoutScroll = keyboardFormLayout({
    viewportHeight: SMALL_ANDROID_VIEWPORT.height,
    keyboardHeight: DEFAULT_ANDROID_KEYBOARD_HEIGHT,
    focusedFieldBottom,
    ctaBottom,
  });
  const scrollOffset = Math.max(0, ctaBottom - withoutScroll.visibleHeight + 16);
  const withScroll = keyboardFormLayout({
    viewportHeight: SMALL_ANDROID_VIEWPORT.height,
    keyboardHeight: DEFAULT_ANDROID_KEYBOARD_HEIGHT,
    focusedFieldBottom,
    ctaBottom,
    scrollOffset,
  });
  return { withoutScroll, withScroll };
}

export type SearchableClass = {
  id?: string;
  name?: string;
  className?: string;
  code?: string;
  classCode?: string;
  publicId?: string;
};

export function normalizeSearch(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function filterClassesByQuery<T extends SearchableClass>(classes: T[], query: string): T[] {
  const needle = normalizeSearch(query);
  if (!needle) return classes;
  return classes.filter((item) => {
    const name = normalizeSearch(String(item.name ?? item.className ?? ""));
    const code = normalizeSearch(String(item.code ?? item.classCode ?? item.publicId ?? ""));
    return name.includes(needle) || code.includes(needle);
  });
}

export type PaymentLine = {
  feeLabel?: string;
  feeType?: string;
  amount?: number | string;
};

export type ReceiptLayoutLine = {
  label: string;
  amountText: string;
  amount: number;
};

export function formatMoneyAmount(amount: number | string | undefined): string {
  const value = Number(amount || 0);
  return `${value.toLocaleString("fr-FR")} FC`;
}

export function layoutPaymentReceipt(items: PaymentLine[], total?: number): {
  lines: ReceiptLayoutLine[];
  totalText: string;
  total: number;
  truncatedCritical: boolean;
} {
  const lines = items.map((item) => {
    const amount = Number(item.amount || 0);
    const label = String(item.feeLabel || item.feeType || "Libellé").trim();
    return {
      label,
      amount,
      amountText: formatMoneyAmount(amount),
    };
  });
  const computedTotal = total ?? lines.reduce((sum, line) => sum + line.amount, 0);
  const totalText = formatMoneyAmount(computedTotal);
  const truncatedCritical = [...lines.map((line) => line.amountText), totalText].some((text) =>
    /…|\.\.\.$/.test(text),
  );
  return { lines, totalText, total: computedTotal, truncatedCritical };
}

export function statusPresentation(status: string): { label: string; icon: string } {
  const value = String(status ?? "").trim();
  const normalized = value.toLowerCase();
  if (["payé", "paye", "paid", "réglé", "regle"].includes(normalized)) {
    return { label: value || "Payé", icon: "checkmark-circle" };
  }
  if (["impayé", "impaye", "pending", "à payer", "a payer"].includes(normalized)) {
    return { label: value || "Impayé", icon: "time" };
  }
  if (["annulé", "annule", "cancelled"].includes(normalized)) {
    return { label: value || "Annulé", icon: "close-circle" };
  }
  if (["présent", "present"].includes(normalized)) {
    return { label: value || "Présent", icon: "checkmark" };
  }
  if (["absent"].includes(normalized)) {
    return { label: value || "Absent", icon: "remove-circle" };
  }
  if (["retard"].includes(normalized)) {
    return { label: value || "Retard", icon: "alarm" };
  }
  if (["justifié", "justifie"].includes(normalized)) {
    return { label: value || "Justifié", icon: "document-text" };
  }
  if (["validée", "validee", "validated"].includes(normalized)) {
    return { label: value || "Validée", icon: "shield-checkmark" };
  }
  if (["queued", "en attente", "file"].includes(normalized)) {
    return { label: value || "En file", icon: "cloud-upload" };
  }
  if (["offline", "hors ligne"].includes(normalized)) {
    return { label: value || "Hors ligne", icon: "cloud-offline" };
  }
  if (["error", "erreur", "failed", "échec", "echec"].includes(normalized)) {
    return { label: value || "Erreur", icon: "alert-circle" };
  }
  return { label: value || "Statut", icon: "ellipse" };
}

export function statusHasNonColorCue(status: string): boolean {
  const presented = statusPresentation(status);
  return Boolean(presented.label.trim()) && Boolean(presented.icon);
}

export function attendanceActionForStudent(studentId: string, status: AttendanceAction) {
  return {
    studentId: String(studentId),
    status,
    testID: USABILITY_TEST_IDS.attendanceAction(String(studentId), status),
    accessibilityLabel: `${status} pour l'élève`,
    accessibilityState: { selected: true as const },
  };
}

export function iconButtonAccessibility(action: string, subject?: string): string {
  const detail = String(subject ?? "").trim();
  return detail ? `${action} ${detail}` : action;
}

export function planningChipState(selected: boolean) {
  return {
    accessibilityRole: "button" as const,
    accessibilityState: { selected },
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
  };
}

export function compactPersonLine(parts: Array<string | undefined | null>, maxParts = 3): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .slice(0, maxParts)
    .join(" • ");
}
