"use strict";
const { principalHasRole } = require("./userRoleLifecycle");
/** Le rôle pédagogique est un droit actif, pas nécessairement le rôle primaire. */
function isAttendanceTeacherPrincipal(principal) {
  return principalHasRole(principal, "Enseignant");
}
module.exports = { isAttendanceTeacherPrincipal };
