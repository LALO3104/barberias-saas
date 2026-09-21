import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina clases de Tailwind de forma segura: acepta valores condicionales
 * (booleanos, undefined, arrays) vía clsx y resuelve conflictos entre
 * utilidades (p. ej. "px-2" y "px-4" pasadas juntas) vía tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
