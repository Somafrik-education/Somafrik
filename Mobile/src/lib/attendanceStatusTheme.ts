/**
 * Source unique des couleurs de statut d'appel.
 * Alignée sur les KPI Présents / Absents / Retards / Taux.
 */

export const ATTENDANCE_STATUS_COLORS = {
  present: "#16A34A",
  absent: "#DC2626",
  late: "#D97706",
  excused: "#2563EB",
  idleFill: "#F1F5F9",
  idleText: "#334155",
  selectedText: "#FFFFFF",
  selectedBorder: "#0F172A",
} as const;

export type AttendanceThemeStatus = "Présent" | "Absent" | "Retard" | "Justifié";

export const ATTENDANCE_STATUS_THEME = {
  Présent: {
    key: "present",
    label: "Présent",
    semantic: "success",
    fill: ATTENDANCE_STATUS_COLORS.present,
    text: ATTENDANCE_STATUS_COLORS.selectedText,
    icon: "checkmark",
  },
  Absent: {
    key: "absent",
    label: "Absent",
    semantic: "danger",
    fill: ATTENDANCE_STATUS_COLORS.absent,
    text: ATTENDANCE_STATUS_COLORS.selectedText,
    icon: "remove-circle",
  },
  Retard: {
    key: "late",
    label: "Retard",
    semantic: "warning",
    fill: ATTENDANCE_STATUS_COLORS.late,
    text: ATTENDANCE_STATUS_COLORS.selectedText,
    icon: "alarm",
  },
  Justifié: {
    key: "excused",
    label: "Justifié",
    semantic: "info",
    fill: ATTENDANCE_STATUS_COLORS.excused,
    text: ATTENDANCE_STATUS_COLORS.selectedText,
    icon: "document-text",
  },
} as const;

export type AttendanceActionVisual = {
  fill: string;
  text: string;
  borderColor: string;
  borderWidth: number;
  fontWeight: "800" | "900";
  icon?: string;
  selected: boolean;
  disabled: boolean;
};

export function attendanceStatusTheme(
  status: AttendanceThemeStatus,
  options: { selected: boolean; disabled?: boolean } = { selected: false },
): AttendanceActionVisual {
  const selected = Boolean(options.selected);
  const disabled = Boolean(options.disabled);
  const token = ATTENDANCE_STATUS_THEME[status];
  if (!selected) {
    return {
      fill: ATTENDANCE_STATUS_COLORS.idleFill,
      text: ATTENDANCE_STATUS_COLORS.idleText,
      borderColor: "transparent",
      borderWidth: 0,
      fontWeight: "800",
      selected: false,
      disabled,
    };
  }
  return {
    fill: token.fill,
    text: token.text,
    borderColor: ATTENDANCE_STATUS_COLORS.selectedBorder,
    borderWidth: 2,
    fontWeight: "900",
    icon: token.icon,
    selected: true,
    disabled,
  };
}

export function attendanceActionSlug(status: AttendanceThemeStatus): string {
  return ATTENDANCE_STATUS_THEME[status].key;
}
