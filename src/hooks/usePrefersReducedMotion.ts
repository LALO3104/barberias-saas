"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  // No hay `window` en el servidor; se asume "sin preferencia" hasta que
  // el cliente confirme el valor real tras hidratar.
  return false;
}

/**
 * Devuelve `true` si el usuario activó "reducir movimiento" en su sistema
 * operativo (prefers-reduced-motion: reduce), y se mantiene sincronizado si
 * la preferencia cambia mientras la app sigue abierta.
 *
 * Usa `useSyncExternalStore` — la forma correcta de suscribirse a una API
 * externa del navegador — en vez de useState + useEffect, para no provocar
 * renders en cascada ni desajustes de hidratación entre servidor y cliente.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
