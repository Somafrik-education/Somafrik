import { describe, expect, it, vi } from "vitest";
import { revokeWebPushOnSessionEnd, syncWebPushSubscription } from "./webPushPermission";

function grantedNotification(permission: NotificationPermission = "granted") {
  return {
    permission,
    requestPermission: async () => permission,
  };
}

describe("WEB-PUSH permission navigateur", () => {
  it("permission denied : aucun subscribe, aucun stockage serveur", async () => {
    const subscribe = vi.fn();
    const saveSubscription = vi.fn();
    const fetchConfig = vi.fn();
    const serviceWorker = {
      register: vi.fn(),
      ready: Promise.resolve({} as ServiceWorkerRegistration),
    };

    const status = await syncWebPushSubscription({
      notification: { permission: "denied", requestPermission: async () => "denied" },
      serviceWorker,
      subscribe,
      fetchConfig,
      saveSubscription,
    });

    expect(status).toBe("denied");
    expect(subscribe).not.toHaveBeenCalled();
    expect(saveSubscription).not.toHaveBeenCalled();
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it("permission default refusée après prompt : pas d'abonnement", async () => {
    const requestPermission = vi.fn(async () => "denied" as NotificationPermission);
    const subscribe = vi.fn();
    const saveSubscription = vi.fn();

    const status = await syncWebPushSubscription({
      notification: { permission: "default", requestPermission },
      serviceWorker: {
        register: vi.fn(),
        ready: Promise.resolve({} as ServiceWorkerRegistration),
      },
      subscribe,
      saveSubscription,
      fetchConfig: vi.fn(),
    });

    expect(status).toBe("denied");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("permission granted : subscribe + stockage session", async () => {
    const subscribe = vi.fn(async () => ({
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/somafrik-web",
        keys: { p256dh: "p256", auth: "authk" },
      }),
    }));
    const saveSubscription = vi.fn(async () => ({ id: "sub-1" }));
    const register = vi.fn(async () => ({}));

    const status = await syncWebPushSubscription({
      notification: grantedNotification("granted"),
      serviceWorker: {
        register,
        ready: Promise.resolve({} as ServiceWorkerRegistration),
      },
      subscribe: subscribe as never,
      fetchConfig: async () => ({ enabled: true, vapidPublicKey: "test-web-push-vapid-public" }),
      saveSubscription,
      swUrl: "/sw.js",
      swScope: "/",
    });

    expect(status).toBe("subscribed");
    expect(register).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    expect(saveSubscription).toHaveBeenCalledWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/somafrik-web",
      keys: { p256dh: "p256", auth: "authk" },
    });
  });

  it("VAPID absent : disabled, pas de PushManager.subscribe", async () => {
    const subscribe = vi.fn();
    const status = await syncWebPushSubscription({
      notification: grantedNotification("granted"),
      serviceWorker: {
        register: vi.fn(),
        ready: Promise.resolve({} as ServiceWorkerRegistration),
      },
      subscribe,
      fetchConfig: async () => ({ enabled: false, vapidPublicKey: null }),
      saveSubscription: vi.fn(),
    });
    expect(status).toBe("disabled");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("révocation session : DELETE endpoint puis unsubscribe local", async () => {
    const unsubscribe = vi.fn(async () => true);
    const revokeSubscription = vi.fn(async () => ({ revoked: true }));
    const status = await revokeWebPushOnSessionEnd({
      getSubscription: async () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/somafrik-web",
        unsubscribe,
      }),
      revokeSubscription,
    });
    expect(status).toBe("revoked");
    expect(revokeSubscription).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/somafrik-web");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("révocation session : aucun appel si pas d'abonnement", async () => {
    const revokeSubscription = vi.fn();
    const status = await revokeWebPushOnSessionEnd({
      getSubscription: async () => null,
      revokeSubscription,
    });
    expect(status).toBe("none");
    expect(revokeSubscription).not.toHaveBeenCalled();
  });

  it("VAPID disabled / aucun SW enregistré : none sans attendre serviceWorker.ready", async () => {
    const getRegistration = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: new Promise(() => undefined),
        getRegistration,
        register: vi.fn(),
      },
    });
    const revokeSubscription = vi.fn();
    try {
      const started = Date.now();
      const status = await revokeWebPushOnSessionEnd({ revokeSubscription });
      expect(status).toBe("none");
      expect(getRegistration).toHaveBeenCalled();
      expect(revokeSubscription).not.toHaveBeenCalled();
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("révocation bornée : getSubscription qui ne se résout jamais → none", async () => {
    const revokeSubscription = vi.fn();
    const started = Date.now();
    const status = await revokeWebPushOnSessionEnd({
      timeoutMs: 30,
      getSubscription: () => new Promise(() => undefined),
      revokeSubscription,
    });
    expect(status).toBe("none");
    expect(revokeSubscription).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("erreur API browser : unsubscribe local tenté, pas de throw", async () => {
    const unsubscribe = vi.fn(async () => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = await revokeWebPushOnSessionEnd({
      getSubscription: async () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/somafrik-web",
        unsubscribe,
      }),
      revokeSubscription: async () => {
        throw new Error("network down");
      },
    });
    expect(status).toBe("revoked");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
