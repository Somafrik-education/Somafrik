function resolveAuditSchoolCode(principal = {}, options = {}) {
  const override = String(options.schoolCode ?? "").trim();
  if (override && override !== "*") return override;
  const membership = String(principal.enrollmentLoginCode ?? "").trim();
  if (membership && membership !== "*") return membership;
  return principal.schoolCode;
}

class AuditService {
  constructor(repository) {
    this.repository = repository;
  }

  async record(req, action, entityType, entityId, newValue = {}, options = {}) {
    const principal = req.principal ?? {};
    await this.repository.recordAudit({
      schoolCode: resolveAuditSchoolCode(principal, options),
      userId: principal.sub,
      action,
      entityType,
      entityId,
      newValue,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
  }
}

module.exports = { AuditService, resolveAuditSchoolCode };
