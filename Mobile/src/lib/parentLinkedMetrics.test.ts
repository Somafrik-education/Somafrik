import assert from "node:assert/strict";
import { applyLivePermissionsToSession, type RefreshableSession } from "./livePermissionsRefresh";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
  sessionStudentAliasKeys,
} from "./canonicalStudentIdentity";
import {
  PARENT_UNLINKED_COPY,
  PARENT_UNLINKED_KPI,
  countLinkedParentChildren,
  parentChildNameFromSession,
  parentHomeIdentityName,
  parentPresenceSummary,
  parentRatioKpiLabel,
} from "./parentLinkedMetrics";

const CHILD_CODE = "CD-IN-EL-26-001";
const CHILD_UUID = "33333333-3333-4333-8333-333333333333";
const OTHER = "CD-KN-EL-26-009";

const linkedUser = {
  id: "parent-1",
  children: [
    {
      id: CHILD_CODE,
      studentUuid: CHILD_UUID,
      name: "Maeva Kabila",
      className: "6ème A",
      schoolCode: "CD-IN-26-001",
    },
  ],
};

assert.equal(countLinkedParentChildren(linkedUser), 1);
assert.equal(countLinkedParentChildren({ children: [] }), 0);
assert.equal(
  parentChildNameFromSession({
    user: linkedUser,
    aliasKeys: [CHILD_UUID],
    rosterName: "",
  }),
  "Maeva Kabila",
);
assert.equal(
  parentChildNameFromSession({
    user: linkedUser,
    aliasKeys: [OTHER],
    rosterName: "",
  }),
  "",
);
assert.equal(
  parentHomeIdentityName({ childName: "Maeva Kabila", linkedCount: 1 }),
  "Maeva Kabila",
);
assert.equal(
  parentHomeIdentityName({ childName: "Élève", linkedCount: 0 }),
  PARENT_UNLINKED_COPY,
);
assert.equal(
  parentRatioKpiLabel({ linkedCount: 0, ready: true, numerator: 0, denominator: 0 }),
  PARENT_UNLINKED_KPI,
);
assert.equal(
  parentRatioKpiLabel({ linkedCount: 1, ready: true, numerator: 0, denominator: 4 }),
  "0/4",
);
assert.deepEqual(
  parentPresenceSummary({
    linkedCount: 0,
    ready: true,
    attended: 0,
    total: 0,
    justified: 0,
    rate: 0,
  }),
  { rate: PARENT_UNLINKED_KPI, meta: PARENT_UNLINKED_COPY },
);

const keys = sessionStudentAliasKeys({
  role: "parent_student",
  user: linkedUser,
});
assert.equal(keys.includes(CHILD_CODE), true);
assert.equal(keys.includes(CHILD_UUID), true);
assert.equal(keys.includes(OTHER), false);

const scope = resolveMobileStudentScope({
  role: "parent_student",
  user: linkedUser,
});
const rows = filterRowsByStudentScope(
  [
    { studentId: CHILD_CODE, present: true },
    { studentId: OTHER, present: true },
  ],
  scope,
);
assert.equal(rows.length, 1);
assert.equal(rows[0].studentId, CHILD_CODE);

const emptyScope = resolveMobileStudentScope({
  role: "parent_student",
  user: { id: "parent-1", children: [] },
});
assert.equal(
  filterRowsByStudentScope([{ studentId: CHILD_CODE }, { studentId: OTHER }], emptyScope).length,
  0,
);

const refreshed = applyLivePermissionsToSession(
  {
    role: "parent_student",
    permissions: ["Notes:READ"],
    user: { id: "parent-1", children: [] },
  } as RefreshableSession,
  {
    permissions: ["Notes:READ"],
    children: linkedUser.children,
  },
);
assert.equal(countLinkedParentChildren(refreshed.user), 1);
assert.equal(refreshed.user?.children?.[0]?.name, "Maeva Kabila");

const preserved = applyLivePermissionsToSession(
  {
    role: "parent_student",
    permissions: ["Notes:READ"],
    user: linkedUser,
  } as RefreshableSession,
  { permissions: ["Présences:READ"] },
);
assert.equal(countLinkedParentChildren(preserved.user), 1);

console.log("OK: parentLinkedMetrics — identité, KPI sans 0/0, refresh enfants");
