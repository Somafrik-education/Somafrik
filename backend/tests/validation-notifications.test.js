const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  enrichStateWithValidationAlerts,
  buildUserValidationNotification,
} = require("../lib/validationNotifications");

describe("Alertes validation Super Admin", () => {
  it("crée une notification pour un nouvel Admin École en attente", () => {
    const current = { users: [], schools: [], notifications: [] };
    const next = {
      users: [
        {
          id: "USR-1",
          role: "Admin School",
          firstName: "Jean",
          lastName: "Admin",
          identifier: "ADM-0001",
          schoolCode: "CD-2026-0001",
          countryScope: "RDC",
          status: "En attente de validation",
          validationStatus: "En attente de validation",
          validationRequestedBy: "admin-rdc",
        },
      ],
      schools: [],
      notifications: [],
    };

    const enriched = enrichStateWithValidationAlerts(current, next, {
      identifier: "admin-rdc",
      role: "Admin Pays",
    });

    assert.equal(enriched.notifications.length, 1);
    assert.equal(enriched.notifications[0].id, "NOTIF-VAL-USER-USR-1");
    assert.equal(enriched.notifications[0].audience, "Super Administrateur Somafrik");
    assert.equal(enriched.notifications[0].status, "Non lu");
    assert.match(enriched.notifications[0].message, /admin-rdc/i);
  });

  it("ne duplique pas une alerte existante", () => {
    const notification = buildUserValidationNotification(
      { id: "USR-1", role: "Admin School", identifier: "ADM-0001" },
      "admin-rdc",
    );
    const current = { users: [], notifications: [notification] };
    const next = {
      users: [
        {
          id: "USR-1",
          role: "Admin School",
          identifier: "ADM-0001",
          status: "En attente de validation",
          validationStatus: "En attente de validation",
        },
      ],
      notifications: [notification],
    };

    const enriched = enrichStateWithValidationAlerts(current, next);
    assert.equal(enriched.notifications.length, 1);
  });

  it("marque l'alerte comme lue après validation Super Admin", () => {
    const current = {
      users: [
        {
          id: "USR-1",
          role: "Admin School",
          identifier: "ADM-0001",
          status: "En attente de validation",
          validationStatus: "En attente de validation",
        },
      ],
      notifications: [
        {
          id: "NOTIF-VAL-USER-USR-1",
          audience: "Super Administrateur Somafrik",
          status: "Non lu",
        },
      ],
    };
    const next = {
      users: [
        {
          id: "USR-1",
          role: "Admin School",
          identifier: "ADM-0001",
          status: "Actif",
          validationStatus: "Validé",
        },
      ],
      notifications: current.notifications,
    };

    const enriched = enrichStateWithValidationAlerts(current, next);
    assert.equal(enriched.notifications[0].status, "Lu");
  });
});
