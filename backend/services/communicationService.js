class CommunicationService {
  constructor({ notifications = [] }) {
    this.notifications = notifications;
  }

  isUnreadStatus(status) {
    const normalized = String(status ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    return normalized !== "lu" && normalized !== "read" && normalized !== "lu(e)";
  }

  getUnreadCount(notifications) {
    return notifications.filter((notification) => this.isUnreadStatus(notification.status)).length;
  }

  matchesSuperAdminAudience(audience) {
    const normalized = String(audience ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized === "tous") return true;
    return (
      normalized.includes("super administrateur") ||
      normalized.includes("super admin") ||
      normalized.includes("superadmin")
    );
  }

  enrichNotifications(notifications) {
    return notifications.map((notification) => ({
      priority: "Moyenne",
      channels: ["Web", "Tablette", "Mobile"],
      attachmentUrl: "",
      sentAt: notification.date,
      audit: [
        {
          action: "Création",
          actorId: notification.createdBy ?? "Système",
          date: notification.createdAt ?? notification.date,
        },
        {
          action: "Envoi",
          actorId: notification.createdBy ?? "Système",
          date: notification.sentAt ?? notification.date,
        },
      ],
      ...notification,
    }));
  }

  filterByAudience(audience, countryCode) {
    const notifications = this.notifications.filter((notification) => {
      if (this.matchesSuperAdminAudience(audience)) {
        return this.matchesSuperAdminAudience(notification.audience);
      }

      const normalizedAudience = String(notification.audience ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
      if (normalizedAudience === "tous") {
        return true;
      }

      return notification.audience === audience && notification.countryCode === countryCode;
    });

    return this.enrichNotifications(notifications);
  }
}

module.exports = { CommunicationService };
