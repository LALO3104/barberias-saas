"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

/**
 * "Mi barbería" como app instalable del personal (modelo: Fishmar).
 *
 *   <PwaRegistrar />     registra /sw.js (solo producción) y avisa sin conexión.
 *   <InstallAppPrompt /> botón / aviso "Instalar Mi barbería":
 *                          · Android/Chrome: ventana de instalación del sistema.
 *                          · iPhone: pasos (Compartir → Agregar a inicio).
 *                          · Otros: indicación genérica del menú del navegador.
 */

// ─── Estado compartido del evento de instalación ────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DISMISS_KEY = "mi-barberia:instalar-oculto";

/** ¿El aviso de instalación fue descartado en este navegador? (sin almacenamiento → no) */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // sin almacenamiento: se vuelve a ofrecer la próxima vez
  }
  notify();
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// ─── Registro del service worker + aviso sin conexión ───────────────────────

export function PwaRegistrar() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Sin service worker la app funciona igual con internet.
      });
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // se muestra con nuestro botón, no con el mini-aviso del navegador
      deferredPrompt = e as BeforeInstallPromptEvent;
      notify();
    };
    const onInstalled = () => {
      installed = true;
      deferredPrompt = null;
      notify();
    };
    const syncOnline = () => setOffline(!navigator.onLine);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    syncOnline();

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pointer-events-none"
    >
      <p className="rounded-button border border-amber-500/30 bg-background-secondary px-4 py-2 text-sm font-sans text-amber-300 shadow-card">
        Sin conexión. Los cambios no se guardarán hasta que vuelva el internet.
      </p>
    </div>
  );
}

// ─── Instalación ────────────────────────────────────────────────────────────

function useInstallState() {
  const canPrompt = useSyncExternalStore(
    subscribe,
    () => deferredPrompt !== null,
    () => false
  );
  const justInstalled = useSyncExternalStore(subscribe, () => installed, () => false);
  // standalone / iOS solo se conocen en el navegador; antes de hidratar se asume
  // "instalada" para no mostrar el aviso de más ni provocar diferencias SSR.
  const standalone = useSyncExternalStore(subscribe, isStandalone, () => true);
  const ios = useSyncExternalStore(subscribe, isIOS, () => false);
  return { canPrompt, ios, isInstalled: standalone || justInstalled };
}

interface InstallAppPromptProps {
  /** `banner`: aviso descartable (Inicio, solo teléfono). `row`: fila del menú "Más". */
  variant: "banner" | "row";
}

export function InstallAppPrompt({ variant }: InstallAppPromptProps) {
  const { canPrompt, ios, isInstalled } = useInstallState();
  const [steps, setSteps] = useState<"ios" | "other" | null>(null);
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      const event = deferredPrompt;
      await event.prompt();
      const { outcome } = await event.userChoice;
      deferredPrompt = null;
      if (outcome === "accepted") installed = true;
      notify();
      return;
    }
    setSteps(ios ? "ios" : "other");
  }, [ios]);

  if (isInstalled) return null;
  if (variant === "banner" && dismissed) return null;

  const dismiss = saveDismissed;

  return (
    <>
      {variant === "banner" ? (
        <div className="flex items-center gap-3 rounded-card border border-accent/25 bg-accent/5 p-3 pr-2 lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa/icon/192" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-button" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-sans font-semibold text-foreground">Instala Mi barbería</p>
            <p className="text-sm font-sans text-muted">Ábrela con un toque, como cualquier app.</p>
          </div>
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-button bg-accent px-3.5 py-2 text-sm font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Instalar
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Ahora no"
            className="flex h-10 w-8 shrink-0 items-center justify-center rounded-button text-muted transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.94]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={install}
          className={cn(
            "flex w-full items-center gap-3 rounded-button px-3 py-3 text-left text-sm font-sans text-foreground",
            "transition-[background-color,transform] duration-150 ease-out hover:bg-border/50 active:bg-border/60"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa/icon/192" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded" />
          <span className="flex-1">Instalar Mi barbería en este celular</span>
          {canPrompt && <span className="text-label font-sans uppercase tracking-label text-accent">Instalar</span>}
        </button>
      )}

      <Dialog
        open={steps !== null}
        onClose={() => setSteps(null)}
        title="Instalar Mi barbería"
      >
        {steps === "ios" ? (
          <ol className="space-y-4 text-body font-sans text-foreground">
            <Step n={1}>
              Toca el botón <strong className="font-semibold">Compartir</strong>{" "}
              <ShareIcon /> en la barra de Safari.
            </Step>
            <Step n={2}>
              Elige <strong className="font-semibold">Agregar a inicio</strong>.
            </Step>
            <Step n={3}>
              Abre <strong className="font-semibold">Mi barbería</strong> desde tu pantalla de inicio.
            </Step>
          </ol>
        ) : (
          <p className="text-body font-sans text-muted">
            Abre el menú de tu navegador y elige{" "}
            <strong className="font-semibold text-foreground">Instalar app</strong> o{" "}
            <strong className="font-semibold text-foreground">Agregar a la pantalla de inicio</strong>.
          </p>
        )}
        <button
          type="button"
          onClick={() => setSteps(null)}
          className="mt-6 w-full rounded-button bg-accent py-3 text-body font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out active:scale-[0.97]"
        >
          Entendido
        </button>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/40 text-sm font-sans font-semibold text-accent">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="inline h-5 w-5 -translate-y-0.5 text-accent"
      aria-label="Compartir"
      role="img"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"
      />
    </svg>
  );
}
