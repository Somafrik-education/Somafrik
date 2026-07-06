/** État BackOffice vide (aucune donnée métier). */
function buildEmptyBackOfficeState() {
  return {
    schools: [],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    payments: [],
    paymentStatuses: [],
    presences: [],
    notes: [],
    exams: [],
    bulletins: [],
    documents: [],
    academicConfigs: {},
    announcements: [],
    messages: [],
    auditLog: [],
    rolePermissions: {},
    dashboardChartConfig: { platform: {}, establishment: {} },
    deletedRows: {},
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { buildEmptyBackOfficeState };
