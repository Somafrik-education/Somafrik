import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import QueryStateView from "../components/QueryStateView";
import { hasSecurityPermission } from "../domain/security/permissions";
import { DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  createCourseSchedule,
  createCourseScheduleReplacement,
  deleteCourseSchedule,
  getReplacementTeacherOptions,
  updateCourseSchedule,
} from "../services/api";
import {
  displayedOccurrencesForDay,
  mapPlanningConflictMessage,
  nearestOccurrenceDate,
  PLANNING_V2_COPY,
  PLANNING_V2_TEST_IDS,
  PLANNING_WEEKDAY_CHIPS,
  selectableRooms,
  type CanonicalWeeklySlot,
  type DisplayedOccurrence,
  type PlanningCourseOption,
  type ReplacementTeacherOption,
} from "../lib/planningV2";

type Mode = "list" | "create" | "edit" | "replace";

function todayDayOfWeek(): number {
  const js = new Date().getDay();
  return js === 0 ? 7 : js;
}

export default function TimetableScreen() {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const contentStyle = [
    styles.content,
    {
      paddingBottom: stackPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%" as const,
    },
  ];
  const { session } = useAuth();
  const {
    courseSchedulesSnapshot,
    planningCourseOptionsSnapshot,
    roomsSnapshot,
    replacementsSnapshot,
    loadPlanningWeekly,
    loadPlanningCourseOptions,
    loadRooms,
    loadReplacements,
  } = useAdminData();

  const canWrite = hasSecurityPermission(session, "Planning de cours", "CREATE");
  const canUpdate = hasSecurityPermission(session, "Planning de cours", "UPDATE");
  const canDelete = hasSecurityPermission(session, "Planning de cours", "DELETE");
  const canReplace = hasSecurityPermission(session, "Remplacements", "CREATE");
  const canReadRooms = hasSecurityPermission(session, "Salles", "READ");
  const canReadReplacements = hasSecurityPermission(session, "Remplacements", "READ");

  const [selectedDay, setSelectedDay] = useState(todayDayOfWeek() === 7 ? 1 : todayDayOfWeek());
  const [mode, setMode] = useState<Mode>("list");
  const [editing, setEditing] = useState<CanonicalWeeklySlot | null>(null);
  const [schoolCourseId, setSchoolCourseId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [occurrenceDate, setOccurrenceDate] = useState("");
  const [substituteTeacherId, setSubstituteTeacherId] = useState("");
  const [substituteOptions, setSubstituteOptions] = useState<ReplacementTeacherOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [optionsError, setOptionsError] = useState("");

  const refreshPlanning = useCallback(async () => {
    await loadPlanningWeekly();
    if (canReadReplacements) await loadReplacements();
    if (canWrite || canUpdate) await loadPlanningCourseOptions();
    if (canReadRooms && (canWrite || canUpdate)) await loadRooms();
  }, [
    canReadReplacements,
    canReadRooms,
    canUpdate,
    canWrite,
    loadPlanningCourseOptions,
    loadPlanningWeekly,
    loadReplacements,
    loadRooms,
  ]);

  useFocusEffect(
    useCallback(() => {
      void refreshPlanning();
    }, [refreshPlanning]),
  );

  const occurrenceDateForDay = nearestOccurrenceDate(selectedDay);
  const replacements = replacementsSnapshot.status === "error" || replacementsSnapshot.status === "offline"
    ? []
    : replacementsSnapshot.data;
  const occurrences = useMemo(
    () =>
      displayedOccurrencesForDay({
        slots: courseSchedulesSnapshot.data,
        replacements,
        dayOfWeek: selectedDay,
        occurrenceDate: occurrenceDateForDay,
      }),
    [courseSchedulesSnapshot.data, replacements, selectedDay, occurrenceDateForDay],
  );

  const roomsForForm = selectableRooms(roomsSnapshot.data, editing?.roomId);
  const courseOptions = planningCourseOptionsSnapshot.data;
  const selectedOption = courseOptions.find((row) => row.schoolCourseId === schoolCourseId) ?? null;

  const showQueryState =
    courseSchedulesSnapshot.status === "idle" ||
    courseSchedulesSnapshot.status === "loading" ||
    courseSchedulesSnapshot.status === "error" ||
    courseSchedulesSnapshot.status === "offline" ||
    courseSchedulesSnapshot.status === "empty" ||
    (courseSchedulesSnapshot.status === "success" && occurrences.length === 0 && mode === "list");

  const openCreate = () => {
    setMode("create");
    setEditing(null);
    setSchoolCourseId(courseOptions[0]?.schoolCourseId ?? "");
    setDayOfWeek(selectedDay === 7 ? 1 : selectedDay);
    setStartTime("08:00");
    setEndTime("09:00");
    setRoomId(null);
    setSaveError("");
  };

  const openEdit = (slot: CanonicalWeeklySlot) => {
    if (!canUpdate) return;
    setMode("edit");
    setEditing(slot);
    setSchoolCourseId(slot.schoolCourseId);
    setDayOfWeek(slot.dayOfWeek);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    setRoomId(slot.roomId);
    setSaveError("");
  };

  const openReplace = async (slot: CanonicalWeeklySlot) => {
    if (!canReplace) return;
    const date = nearestOccurrenceDate(slot.dayOfWeek);
    setMode("replace");
    setEditing(slot);
    setOccurrenceDate(date);
    setSubstituteTeacherId("");
    setSaveError("");
    setOptionsError("");
    try {
      const options = await getReplacementTeacherOptions(slot.id, date);
      setSubstituteOptions(options);
      setSubstituteTeacherId(options.find((row) => row.selectable)?.teacherId ?? "");
    } catch (error) {
      setSubstituteOptions([]);
      setOptionsError(mapPlanningConflictMessage(error));
    }
  };

  const handleSaveSlot = async () => {
    if (saving) return;
    const option = selectedOption;
    if (!option && mode === "create") {
      setSaveError("Choisissez un cours planifiable.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      if (mode === "create" && option) {
        await createCourseSchedule({
          schoolCourseId: option.schoolCourseId,
          academicYearId: option.academicYearId,
          dayOfWeek,
          startTime,
          endTime,
          roomId,
        });
      } else if (mode === "edit" && editing) {
        await updateCourseSchedule(editing.id, {
          schoolCourseId: schoolCourseId || editing.schoolCourseId,
          academicYearId: option?.academicYearId || editing.academicYearId,
          dayOfWeek,
          startTime,
          endTime,
          roomId,
        });
      }
      setMode("list");
      setEditing(null);
      await loadPlanningWeekly();
    } catch (error) {
      setSaveError(mapPlanningConflictMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || !canDelete || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await deleteCourseSchedule(editing.id);
      setMode("list");
      setEditing(null);
      await loadPlanningWeekly();
    } catch (error) {
      setSaveError(mapPlanningConflictMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveReplacement = async () => {
    if (saving || !editing) return;
    if (!substituteTeacherId) {
      setSaveError("Choisissez un remplaçant.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await createCourseScheduleReplacement({
        weeklySlotId: editing.id,
        occurrenceDate,
        substituteTeacherId,
      });
      setMode("list");
      setEditing(null);
      await loadPlanningWeekly();
      await loadReplacements();
    } catch (error) {
      setSaveError(mapPlanningConflictMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const renderDayChips = (value: number, onChange: (day: number) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {PLANNING_WEEKDAY_CHIPS.map((chip) => {
        const active = chip.dayOfWeek === value;
        return (
          <TouchableOpacity
            key={chip.dayOfWeek}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(chip.dayOfWeek)}
            testID={`${PLANNING_V2_TEST_IDS.dayChip}-${chip.dayOfWeek}`}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.short}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderSlotCard = (item: DisplayedOccurrence, compact = false) => (
    <TouchableOpacity
      key={item.id}
      style={styles.card}
      onPress={() => (canUpdate ? openEdit(item) : undefined)}
      disabled={!canUpdate}
      testID={PLANNING_V2_TEST_IDS.slotCard}
    >
      <View style={styles.timeBox}>
        <Text style={styles.time}>{item.startTime}</Text>
        <Text style={styles.timeMuted}>{item.endTime}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.course}>{item.courseName || "Cours"}</Text>
        <Text style={styles.meta}>{item.className || item.classCode}</Text>
        {item.roomName ? <Text style={styles.meta}>{item.roomName}</Text> : null}
        <Text style={styles.meta}>{item.isReplacement ? item.originalTeacherName : item.teacherName}</Text>
        {item.isReplacement ? (
          <Text style={styles.replacement} testID={PLANNING_V2_TEST_IDS.replacementBadge}>
            {PLANNING_V2_COPY.usualTeacher} : {item.originalTeacherName}. {PLANNING_V2_COPY.replacedBy} {item.substituteTeacherName}
          </Text>
        ) : null}
      </View>
      {canReplace && !compact ? (
        <TouchableOpacity onPress={() => void openReplace(item)} accessibilityLabel="Remplacer">
          <Ionicons name="swap-horizontal-outline" size={20} color="#2563EB" />
        </TouchableOpacity>
      ) : (
        <Ionicons name="calendar-outline" size={22} color="#2563EB" />
      )}
    </TouchableOpacity>
  );

  const renderWeekColumns = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow}>
      {PLANNING_WEEKDAY_CHIPS.map((chip) => {
        const items = displayedOccurrencesForDay({
          slots: courseSchedulesSnapshot.data,
          replacements,
          dayOfWeek: chip.dayOfWeek,
          occurrenceDate: nearestOccurrenceDate(chip.dayOfWeek),
        });
        return (
          <View key={chip.dayOfWeek} style={styles.weekCol}>
            <Text style={styles.dayTitle}>{chip.short}</Text>
            {items.length === 0 ? (
              <Text style={styles.muted}>—</Text>
            ) : (
              items.map((item) => renderSlotCard(item, true))
            )}
          </View>
        );
      })}
    </ScrollView>
  );

  if (mode === "create" || mode === "edit") {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
        <Text style={styles.title}>{mode === "create" ? "Nouveau créneau" : "Modifier le créneau"}</Text>
        <Text style={styles.subtitle}>Cours, jour, horaires et salle canoniques. Aucun texte libre.</Text>

        <Text style={styles.label}>Cours</Text>
        {courseOptions.length === 0 ? (
          <Text style={styles.errorText}>Aucun cours planifiable n'est visible pour ce compte.</Text>
        ) : (
          courseOptions.map((option: PlanningCourseOption) => {
            const active = option.schoolCourseId === schoolCourseId;
            return (
              <TouchableOpacity
                key={option.schoolCourseId}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => setSchoolCourseId(option.schoolCourseId)}
                disabled={saving}
              >
                <Text style={styles.optionTitle}>{option.courseName}</Text>
                <Text style={styles.meta}>
                  {option.className} · {option.teacherName || option.teacherCode}
                </Text>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.label}>Jour</Text>
        {renderDayChips(dayOfWeek, setDayOfWeek)}

        <Text style={styles.label}>Début</Text>
        <TextInput
          style={styles.input}
          value={startTime}
          onChangeText={setStartTime}
          editable={!saving}
          placeholder="08:00"
        />
        <Text style={styles.label}>Fin</Text>
        <TextInput
          style={styles.input}
          value={endTime}
          onChangeText={setEndTime}
          editable={!saving}
          placeholder="09:00"
        />

        <Text style={styles.label}>Salle</Text>
        <TouchableOpacity
          style={[styles.option, !roomId && styles.optionActive]}
          onPress={() => setRoomId(null)}
          disabled={saving}
        >
          <Text style={styles.optionTitle}>Sans salle</Text>
        </TouchableOpacity>
        {roomsForForm.map((room) => {
          const active = room.id === roomId;
          const archived = room.status === "archived";
          return (
            <TouchableOpacity
              key={room.id}
              style={[styles.option, active && styles.optionActive, archived && !active && styles.disabled]}
              onPress={() => setRoomId(room.id)}
              disabled={saving || (archived && !active)}
            >
              <Text style={styles.optionTitle}>{room.name}</Text>
              {archived ? <Text style={styles.meta}>Archivée — affichage uniquement</Text> : null}
            </TouchableOpacity>
          );
        })}

        {saveError ? (
          <Text style={styles.errorText} testID={PLANNING_V2_TEST_IDS.conflictError}>
            {saveError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.disabled]}
          onPress={() => void handleSaveSlot()}
          disabled={saving}
          testID={PLANNING_V2_TEST_IDS.saveButton}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{saveError ? PLANNING_V2_COPY.retry : "Enregistrer"}</Text>}
        </TouchableOpacity>
        {mode === "edit" && canDelete ? (
          <TouchableOpacity style={styles.dangerButton} onPress={() => void handleDelete()} disabled={saving}>
            <Text style={styles.primaryText}>Supprimer</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode("list")} disabled={saving}>
          <Text style={styles.secondaryText}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (mode === "replace" && editing) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
        <Text style={styles.title}>Remplacement daté</Text>
        <Text style={styles.subtitle}>
          {editing.courseName} · {editing.startTime}–{editing.endTime}. Le créneau maître n'est pas modifié.
        </Text>
        <Text style={styles.meta}>
          {PLANNING_V2_COPY.usualTeacher} : {editing.teacherName}
        </Text>
        <Text style={styles.label}>Date d'occurrence</Text>
        <TextInput style={styles.input} value={occurrenceDate} onChangeText={setOccurrenceDate} editable={!saving} />
        <Text style={styles.label}>Remplaçant</Text>
        {optionsError ? <Text style={styles.errorText}>{optionsError}</Text> : null}
        {substituteOptions.map((option) => {
          const active = option.teacherId === substituteTeacherId;
          return (
            <TouchableOpacity
              key={option.teacherId}
              style={[styles.option, active && styles.optionActive, !option.selectable && styles.disabled]}
              onPress={() => option.selectable && setSubstituteTeacherId(option.teacherId)}
              disabled={saving || !option.selectable}
            >
              <Text style={styles.optionTitle}>{option.name || option.teacherCode}</Text>
            </TouchableOpacity>
          );
        })}
        {saveError ? (
          <Text style={styles.errorText} testID={PLANNING_V2_TEST_IDS.conflictError}>
            {saveError}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.disabled]}
          onPress={() => void handleSaveReplacement()}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{saveError ? PLANNING_V2_COPY.retry : "Enregistrer le remplacement"}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode("list")} disabled={saving}>
          <Text style={styles.secondaryText}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Emploi du temps</Text>
      <Text style={styles.subtitle}>
        {courseSchedulesSnapshot.status === "success"
          ? `${courseSchedulesSnapshot.data.length} créneau(x) hebdomadaire(s)`
          : "Planning établissement"}
      </Text>

      {canWrite ? (
        <TouchableOpacity style={styles.primaryButton} onPress={openCreate} testID={PLANNING_V2_TEST_IDS.createButton}>
          <Text style={styles.primaryText}>Ajouter un créneau</Text>
        </TouchableOpacity>
      ) : null}

      {!isTablet ? renderDayChips(selectedDay, setSelectedDay) : null}

      {showQueryState && !(isTablet && courseSchedulesSnapshot.status === "success") ? (
        <QueryStateView
          snapshot={
            courseSchedulesSnapshot.status === "success" && occurrences.length === 0
              ? { status: "empty", data: [] }
              : courseSchedulesSnapshot
          }
          emptyMessage={PLANNING_V2_COPY.empty}
          errorMessage={PLANNING_V2_COPY.error}
          offlineMessage={PLANNING_V2_COPY.error}
          emptyTestId={DATA_TRUTH_TEST_IDS.planningEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.planningError}
          onRetry={() => void refreshPlanning()}
        />
      ) : isTablet && courseSchedulesSnapshot.status === "success" ? (
        <View testID={DATA_TRUTH_TEST_IDS.planningList}>{renderWeekColumns()}</View>
      ) : (
        <View testID={DATA_TRUTH_TEST_IDS.planningList}>
          <Text style={styles.dayTitle}>
            {PLANNING_WEEKDAY_CHIPS.find((chip) => chip.dayOfWeek === selectedDay)?.short ?? ""} · {occurrenceDateForDay}
          </Text>
          {occurrences.map((item) => renderSlotCard(item))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { color: "#0F172A", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "800", marginTop: 4, marginBottom: 18 },
  chipRow: { gap: 8, marginBottom: 16 },
  chip: {
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  dayTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  timeBox: {
    width: 72,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    padding: 10,
    marginRight: 12,
  },
  time: { color: "#2563EB", fontWeight: "900", textAlign: "center" },
  timeMuted: { color: "#64748B", fontSize: 12, fontWeight: "800", textAlign: "center", marginTop: 3 },
  cardBody: { flex: 1, minWidth: 0 },
  course: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  meta: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 4 },
  replacement: { color: "#B45309", fontSize: 12, fontWeight: "800", marginTop: 6 },
  muted: { color: "#94A3B8", fontWeight: "700" },
  label: { color: "#0F172A", fontWeight: "800", marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: "700",
  },
  option: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    marginBottom: 8,
  },
  optionActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  optionTitle: { color: "#0F172A", fontWeight: "800" },
  errorText: { color: "#B91C1C", fontWeight: "800", marginTop: 12 },
  primaryButton: {
    backgroundColor: "#2563EB",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  dangerButton: {
    backgroundColor: "#B91C1C",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: { paddingVertical: 12, alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryText: { color: "#334155", fontWeight: "800" },
  disabled: { opacity: 0.5 },
  weekRow: { gap: 12 },
  weekCol: { width: 220 },
});
