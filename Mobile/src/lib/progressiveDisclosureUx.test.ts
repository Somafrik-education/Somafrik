/**
 * Lot 0 — contrat progressive disclosure (îlots déjà verts + décisions CTO).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PD_DEAD_SCREENS,
  PD_EVALUATION_COLLAPSED_OMITS,
  PD_EVALUATION_COLLAPSED_REQUIRES_PROGRESS,
  PD_EVALUATION_PRIMARY_CTA_WHEN_COLLAPSED,
  PD_EVALUATION_SECONDARY_ACTIONS,
  PD_MESSAGES_USE_THREAD_MODAL,
  PD_ROLL_CALL_STATUSES_ALWAYS_VISIBLE,
  PD_UX_SPEC_VERSION,
} from "./progressiveDisclosureUxContract";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

assert.equal(PD_UX_SPEC_VERSION, "1.0");
assert.equal(PD_EVALUATION_PRIMARY_CTA_WHEN_COLLAPSED, true, "option A : Saisir/Consulter visibles fermés");
assert.equal(PD_ROLL_CALL_STATUSES_ALWAYS_VISIBLE, true);
assert.equal(PD_MESSAGES_USE_THREAD_MODAL, true);
assert.equal(PD_EVALUATION_COLLAPSED_REQUIRES_PROGRESS, true);
assert.deepEqual([...PD_EVALUATION_COLLAPSED_OMITS], ["coefficient", "teacherName", "date"]);
assert.deepEqual([...PD_EVALUATION_SECONDARY_ACTIONS], ["Modifier", "Valider", "Publier"]);
assert.deepEqual([...PD_DEAD_SCREENS], [
  "AdminCrudScreen",
  "MenuScreen",
  "PlatformNotificationsScreen",
]);

const entityCard = read("components/ExpandableEntityCard.tsx");
assert.match(entityCard, /defaultExpanded = false/);
assert.match(entityCard, /accessibilityState=\{\{ expanded: isExpanded \}\}/);
assert.match(entityCard, /chevron-up/);
assert.match(entityCard, /chevron-down/);
assert.match(entityCard, /summaryActions \? <View style=\{styles\.summaryActions\}>\{summaryActions\}<\/View> : null/);
assert.match(entityCard, /isExpanded \? <View style=\{styles\.detail\}>\{children\}<\/View> : null/);

const financeCard = read("components/ExpandableFinanceCard.tsx");
assert.match(financeCard, /ExpandableEntityCard/);

const receiptCard = read("components/PaymentReceiptCard.tsx");
assert.match(receiptCard, /ExpandableFinanceCard/);
assert.match(receiptCard, /\{actions\}/);

const paymentsScreen = read("screens/PaymentsScreen.tsx");
assert.match(paymentsScreen, /actions=\{<PaymentCancelControls/);

const unpaidScreen = read("screens/UnpaidScreen.tsx");
assert.match(unpaidScreen, /ExpandableFinanceCard/);

const studentPayments = read("screens/StudentPaymentsScreen.tsx");
assert.match(studentPayments, /actions=\{[\s\S]*PaymentCancelControls/);
assert.doesNotMatch(
  studentPayments,
  /<PaymentReceiptCard[\s\S]*?\/>\s*<PaymentCancelControls/,
  "PD-05 : l'annulation ne doit plus être un frère du reçu",
);

const classesScreen = read("screens/ClassesScreen.tsx");
assert.match(classesScreen, /ExpandableEntityCard/);
assert.match(classesScreen, /expandedClassKey/);

const studentsScreen = read("screens/StudentsScreen.tsx");
assert.match(studentsScreen, /ExpandableEntityCard/);
assert.match(studentsScreen, /expandedStudentId/);

function sliceFirstCard(source: string, tag: string) {
  const start = source.indexOf(`<${tag}`);
  const end = source.indexOf(`</${tag}>`, start);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end);
}

function cardOpening(card: string) {
  const split = card.indexOf(">");
  return split < 0 ? card : card.slice(0, split);
}

const teachersScreen = read("screens/TeachersScreen.tsx");
assert.match(teachersScreen, /ExpandableEntityCard/, "PD-01 : liste enseignants = ExpandableEntityCard");
assert.match(teachersScreen, /expandedTeacherId/);
assert.match(teachersScreen, /extraData=\{expandedTeacherId\}/);
assert.match(teachersScreen, /nextExclusiveExpandedKey\(current, teacher\.id\)/);
assert.doesNotMatch(teachersScreen, /defaultExpanded=\{true\}/);
assert.match(teachersScreen, /<TeacherMutationControls onChanged=\{\(\) => load\(\)\} \/>/);
assert.match(teachersScreen, /AssignmentMutationControls/);
const teachersCreateAt = teachersScreen.indexOf("<TeacherMutationControls onChanged");
const teachersCardAt = teachersScreen.indexOf("<ExpandableEntityCard");
assert.ok(teachersCreateAt >= 0 && teachersCreateAt < teachersCardAt, "PD-01 : création reste hors carte");
const teacherCard = sliceFirstCard(teachersScreen, "ExpandableEntityCard");
assert.ok(teacherCard, "PD-01 : carte enseignant absente");
const teacherOpening = cardOpening(teacherCard);
assert.match(teacherOpening, /title=\{/);
assert.match(teacherOpening, /subtitle=\{/);
assert.match(teacherOpening, /badge=\{/);
assert.doesNotMatch(teacherOpening, /TeacherMutationControls/, "PD-01 : mutations hors résumé");
assert.doesNotMatch(teacherOpening, /teacherCourses/, "PD-01 : cours hors résumé");
assert.doesNotMatch(teacherOpening, /teacherClasses/, "PD-01 : classes hors résumé");
assert.doesNotMatch(teacherOpening, /teacher\.phone/, "PD-01 : téléphone hors résumé");
assert.match(teacherCard, /<TeacherMutationControls[\s\S]*row=\{teacher\}/);
assert.match(teacherCard, /teacherCourses/);
assert.match(teacherCard, /teacherClasses/);
assert.match(teacherCard, /teacher\.phone/);

const announcements = read("screens/AnnouncementsScreen.tsx");
assert.match(announcements, /ExpandableCommunicationCard/);
assert.doesNotMatch(announcements, /defaultExpanded=\{true\}/);

const notifications = read("screens/InternalNotificationsScreen.tsx");
assert.match(notifications, /ExpandableCommunicationCard/);
assert.doesNotMatch(notifications, /defaultExpanded=\{true\}/);

const messages = read("screens/MessagesScreen.tsx");
assert.doesNotMatch(messages, /ExpandableCommunicationCard/);
assert.match(messages, /openConversation|setSelectedConversation/);
assert.match(messages, /Modal visible=\{Boolean\(selectedConversation\)\}/);

const attendance = read("screens/TeacherAttendanceScreen.tsx");
assert.match(attendance, /ATTENDANCE_ACTIONS\.map/);
assert.match(attendance, /setAttendanceStatus\(student\.id, action\)/);
assert.match(attendance, /nextExclusiveExpandedKey\(current, student\.id\)/);
assert.match(attendance, /extraData=\{expandedStudentId\}/);
assert.match(attendance, /accessibilityState=\{\{ expanded: isExpanded \}\}/);
assert.doesNotMatch(attendance, /ExpandableEntityCard/, "PD-03 : pas d'accordéon Entity autour de l'appel");
assert.doesNotMatch(attendance, /getNextStatus/);
assert.match(attendance, /statusAction:[\s\S]*minHeight:\s*MIN_TOUCH_TARGET_DP/);
assert.match(attendance, /statusAction:[\s\S]*minWidth:\s*MIN_TOUCH_TARGET_DP/);
const attendanceRosterStart = attendance.indexOf("renderItem={({ item: student })");
const attendanceRoster = attendanceRosterStart >= 0 ? attendance.slice(attendanceRosterStart) : attendance;
const identityStart = attendanceRoster.indexOf("style={styles.studentIdentity}");
const identityEnd = attendanceRoster.indexOf("</TouchableOpacity>", identityStart);
const attendanceIdentity = identityStart >= 0 && identityEnd > identityStart
  ? attendanceRoster.slice(identityStart, identityEnd)
  : "";
assert.ok(attendanceIdentity, "PD-03 : zone identité élève absente");
assert.match(attendanceIdentity, /nextExclusiveExpandedKey\(current, student\.id\)/);
assert.doesNotMatch(attendanceIdentity, /entry\.arrivalTime/, "PD-03 : arrivée hors résumé");
assert.doesNotMatch(attendanceIdentity, /entry\.reason/, "PD-03 : motif hors résumé");
assert.doesNotMatch(attendanceIdentity, /sourceLabel/, "PD-03 : source hors résumé");
assert.doesNotMatch(attendanceIdentity, /student\.matricule/, "PD-03 : matricule hors résumé");
const detailStart = attendanceRoster.indexOf("styles.studentDetail");
const actionsStart = attendanceRoster.indexOf("statusActions");
const attendanceDetail = detailStart >= 0 && actionsStart > detailStart
  ? attendanceRoster.slice(detailStart, actionsStart)
  : "";
assert.match(attendanceDetail, /student\.matricule/);
assert.match(attendanceDetail, /entry\.arrivalTime/);
assert.match(attendanceDetail, /entry\.reason/);
assert.match(attendanceDetail, /sourceLabel/);
const attendanceActions = actionsStart >= 0 ? attendanceRoster.slice(actionsStart, attendanceRoster.indexOf("ListFooterComponent")) : "";
assert.match(attendanceActions, /ATTENDANCE_ACTIONS\.map/);
assert.match(attendanceActions, /setAttendanceStatus\(student\.id, action\)/);
assert.doesNotMatch(
  attendanceActions,
  /setExpandedStudentId|nextExclusiveExpandedKey/,
  "PD-03 : un bouton P/A/R/J ne bascule pas le détail",
);

const gradesScreen = read("screens/TeacherGradesScreen.tsx");
assert.match(gradesScreen, /ExpandableEntityCard/, "PD-02 : liste évaluations = ExpandableEntityCard");
assert.match(gradesScreen, /expandedEvaluationId/);
assert.match(gradesScreen, /extraData=\{expandedEvaluationId\}/);
assert.match(gradesScreen, /nextExclusiveExpandedKey\(current, evaluation\.evaluationId\)/);
assert.doesNotMatch(gradesScreen, /defaultExpanded=\{true\}/);
assert.match(gradesScreen, /summaryActions=/);
assert.match(gradesScreen, /function EvaluationSummaryActions/);
const gradesCard = sliceFirstCard(gradesScreen, "ExpandableEntityCard");
assert.ok(gradesCard, "PD-02 : carte évaluation absente");
assert.match(gradesCard, /title=\{evaluation\.title\}/);
assert.match(gradesCard, /\$\{evaluation\.className\} • \$\{evaluation\.courseName\}/);
assert.match(gradesCard, /badge=\{evaluation\.status\}/);
assert.doesNotMatch(
  /subtitle=\{[\s\S]*?\}/.exec(gradesCard)?.[0] ?? "",
  /coefficient|teacherName|evaluation\.date/,
  "PD-02 : coef/enseignant/date hors sous-titre fermé",
);
const gradesSummaryStart = gradesScreen.indexOf("function EvaluationSummaryActions");
const gradesSummary = gradesSummaryStart >= 0
  ? gradesScreen.slice(gradesSummaryStart, gradesScreen.indexOf("\nfunction ", gradesSummaryStart + 1))
  : "";
assert.match(gradesSummary, /PEDAGOGY_COPY\.progress/, "PD-02 : progression dans le résumé fermé");
assert.match(gradesSummary, /enterGrades/, "PD-02 : Saisir visible carte fermée");
assert.match(gradesSummary, /consult/, "PD-02 : Consulter visible carte fermée");
assert.doesNotMatch(gradesSummary, /coefficient/, "PD-02 : coefficient hors résumé");
assert.doesNotMatch(gradesSummary, /teacherName/, "PD-02 : enseignant hors résumé");
assert.doesNotMatch(
  gradesSummary,
  /editEvaluation|Publier|validate/,
  "PD-02 : Modifier/Valider/Publier hors résumé fermé",
);
assert.match(gradesCard, /evaluation\.coefficient/, "PD-02 : coefficient en zone dépliée");
assert.match(gradesCard, /evaluation\.teacherName/, "PD-02 : enseignant en zone dépliée");
assert.match(gradesCard, /evaluation\.date/, "PD-02 : date en zone dépliée");
assert.match(gradesCard, /PEDAGOGY_COPY\.editEvaluation/, "PD-02 : Modifier uniquement déplié");
assert.match(gradesCard, /EVALUATIONS_V2_COPY\.validate/, "PD-02 : Valider uniquement déplié");
assert.match(gradesCard, /Publier/, "PD-02 : Publier uniquement déplié");
assert.doesNotMatch(
  gradesCard,
  /enterGrades|consult/,
  "PD-02 : Saisir/Consulter via summaryActions, pas dans children",
);

const usersScreen = read("screens/UsersScreen.tsx");
assert.match(usersScreen, /ExpandableEntityCard/, "PD-04 : liste utilisateurs = ExpandableEntityCard");
assert.match(usersScreen, /expandedUserId/);
assert.match(usersScreen, /extraData=\{expandedUserId\}/);
assert.match(usersScreen, /nextExclusiveExpandedKey\(current, user\.id\)/);
assert.doesNotMatch(usersScreen, /defaultExpanded=\{true\}/);
assert.match(usersScreen, /<UserMutationControls onChanged=\{\(\) => load\(\)\} \/>/);
const usersCreateAt = usersScreen.indexOf("<UserMutationControls onChanged");
const usersCardAt = usersScreen.indexOf("<ExpandableEntityCard");
assert.ok(usersCreateAt >= 0 && usersCreateAt < usersCardAt, "PD-04 : création reste hors carte");
const userCard = sliceFirstCard(usersScreen, "ExpandableEntityCard");
assert.ok(userCard, "PD-04 : carte utilisateur absente");
const userOpening = cardOpening(userCard);
assert.match(userOpening, /title=\{/);
assert.match(userOpening, /user\.firstName/);
assert.match(userOpening, /user\.identifier/);
assert.match(userOpening, /subtitle=\{/);
assert.match(userOpening, /user\.publicId/);
assert.match(userOpening, /badge=\{/);
assert.match(usersScreen, /displayStatusName\(user\.status\)/, "PD-04 : statut en badge");
assert.doesNotMatch(userOpening, /UserMutationControls/, "PD-04 : mutations hors résumé");
assert.doesNotMatch(userOpening, /formatBusinessProfileKind/, "PD-04 : type métier hors résumé");
assert.doesNotMatch(userOpening, /formatAccessRolesDisplay/, "PD-04 : rôles hors résumé");
assert.doesNotMatch(userOpening, /user\.email/, "PD-04 : email hors résumé");
assert.doesNotMatch(userOpening, /user\.phone/, "PD-04 : téléphone hors résumé");
assert.doesNotMatch(userOpening, /user\.schoolCode/, "PD-04 : établissement hors résumé");
assert.match(userCard, /<UserMutationControls[\s\S]*row=\{user\}/, "PD-04 : mutations de ligne en zone ouverte");
assert.match(userCard, /formatBusinessProfileKind/);
assert.match(userCard, /formatAccessRolesDisplay|user-access-roles/);
assert.match(userCard, /user\.email/);
assert.match(userCard, /user\.phone/);
assert.match(userCard, /user\.schoolCode/);

const navigator = read("navigation/AppNavigator.tsx");
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/AdminCrudScreen["']/);
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/MenuScreen["']/);
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/PlatformNotificationsScreen["']/);
assert.doesNotMatch(navigator, /component=\{AdminCrudScreen\}/);
assert.doesNotMatch(navigator, /component=\{MenuScreen\}/);
assert.doesNotMatch(navigator, /component=\{PlatformNotificationsScreen\}/);
assert.match(navigator, /jamais enregistré dans le graphe live/);

console.log("OK Lot 0 UX progressive disclosure : contrat + îlots verts + exceptions CTO");
