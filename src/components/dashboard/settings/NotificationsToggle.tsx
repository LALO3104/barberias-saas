"use client";

import { useEffect, useState, useTransition } from "react";
import { VAPID_PUBLIC_KEY, base64UrlToBytes } from "@/lib/push";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(dashboard)/dashboard/ajustes/actions";
import { ErrorText, PRIMARY, SECONDARY } from "@/components/dashboard/appointments/AppointmentFormParts";

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

async function getRegistration() {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** El barbero activa los avisos de reservas en este teléfono. */
export function NotificationsToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return "off";
      // Mantiene el dispositivo ligado a la cuenta que tiene la sesión.
      await savePushSubscriptionAction(subscription.endpoint);
      return "on";
    }
    check()
      .then((next: Status) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("off");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    setError(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus(permission === "denied" ? "denied" : "off");
          return;
        }
        const registration = await getRegistration();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
        });
        const result = await savePushSubscriptionAction(subscription.endpoint);
        if (result.error) {
          await subscription.unsubscribe();
          setError(result.error);
          return;
        }
        setStatus("on");
      } catch {
        setError("No se pudieron activar las notificaciones en este teléfono. Intenta de nuevo.");
      }
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      try {
        const registration = await getRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const result = await removePushSubscriptionAction(subscription.endpoint);
          if (result.error) {
            setError(result.error);
            return;
          }
          await subscription.unsubscribe();
        }
        setStatus("off");
      } catch {
        setError("No se pudieron desactivar. Intenta de nuevo.");
      }
    });
  }

  return (
    <section className="space-y-4 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
      <div>
        <h2 className="font-display text-lg text-foreground">Notificaciones</h2>
        <p className="mt-1 text-sm font-sans text-muted">
          Recibe un aviso en este teléfono cuando alguien reserve contigo en línea.
        </p>
      </div>

      {status === "unsupported" && (
        <p className="text-sm font-sans text-amber-300">
          Este navegador no las permite. En iPhone, primero instala la app: toca Compartir y luego Agregar a inicio.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm font-sans text-amber-300">
          Las notificaciones están bloqueadas. Permítelas en los ajustes del teléfono para esta app y vuelve aquí.
        </p>
      )}
      {status === "on" && <p className="text-sm font-sans text-accent">Activadas en este teléfono.</p>}
      {error && <ErrorText>{error}</ErrorText>}

      {status === "off" && (
        <button type="button" onClick={enable} disabled={isPending} className={PRIMARY}>
          {isPending ? "Activando…" : "Activar notificaciones"}
        </button>
      )}
      {status === "on" && (
        <button type="button" onClick={disable} disabled={isPending} className={SECONDARY}>
          {isPending ? "Desactivando…" : "Desactivar en este teléfono"}
        </button>
      )}
    </section>
  );
}
