import { describe, expect, it } from "vitest";
import { stripClientAuditLogFromPutPayload } from "./stripClientAuditLog";

describe("stripClientAuditLogFromPutPayload (HOTFIX-RBAC-ADMIN-01)", () => {
  it("retire auditLog et conserve classes", () => {
    const payload = {
      classes: [{ id: "CLS-1", name: "2ème A", schoolCode: "CD-2026-0001" }],
      auditLog: [{ id: "AUD-1", action: "classes.create" }],
    };
    expect(stripClientAuditLogFromPutPayload(payload)).toEqual({
      classes: [{ id: "CLS-1", name: "2ème A", schoolCode: "CD-2026-0001" }],
    });
  });

  it("retire auditLog et conserve teachers/users/contacts", () => {
    const payload = {
      teachers: [{ id: "T-1", name: "Sow" }],
      users: [{ id: "U-1" }],
      contacts: [{ id: "C-1" }],
      auditLog: [{ id: "AUD-2", action: "teachers.create" }],
    };
    const stripped = stripClientAuditLogFromPutPayload(payload);
    expect(stripped).toEqual({
      teachers: [{ id: "T-1", name: "Sow" }],
      users: [{ id: "U-1" }],
      contacts: [{ id: "C-1" }],
    });
    expect("auditLog" in stripped).toBe(false);
  });

  it("no-op si auditLog absent", () => {
    const payload = { classes: [{ id: "CLS-2" }] };
    expect(stripClientAuditLogFromPutPayload(payload)).toEqual(payload);
  });
});
