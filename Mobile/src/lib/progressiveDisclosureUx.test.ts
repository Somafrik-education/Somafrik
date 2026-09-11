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

const classesScreen = read("screens/ClassesScreen.tsx");
assert.match(classesScreen, /ExpandableEntityCard/);
assert.match(classesScreen, /expandedClassKey/);

const studentsScreen = read("screens/StudentsScreen.tsx");
assert.match(studentsScreen, /ExpandableEntityCard/);
assert.match(studentsScreen, /expandedStudentId/);

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

const navigator = read("navigation/AppNavigator.tsx");
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/AdminCrudScreen["']/);
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/MenuScreen["']/);
assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/PlatformNotificationsScreen["']/);
assert.doesNotMatch(navigator, /component=\{AdminCrudScreen\}/);
assert.doesNotMatch(navigator, /component=\{MenuScreen\}/);
assert.doesNotMatch(navigator, /component=\{PlatformNotificationsScreen\}/);
assert.match(navigator, /jamais enregistré dans le graphe live/);

console.log("OK Lot 0 UX progressive disclosure : contrat + îlots verts + exceptions CTO");
