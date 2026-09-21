/**
 * Punto único de entrada a GSAP para todo el proyecto.
 *
 * Por qué existe este archivo:
 * - GSAP y sus plugins (ScrollTrigger, SplitText) tocan el DOM. En Next.js el
 *   mismo módulo puede evaluarse en el servidor (SSR / generación estática) y
 *   en el navegador, así que el registro de plugins se protege con un check
 *   de `window` para no romper el renderizado en el servidor.
 * - Registrar los plugins UNA sola vez aquí evita registros duplicados que
 *   pasarían si cada componente hiciera su propio `gsap.registerPlugin(...)`.
 * - Cualquier componente que necesite animar debe importar `gsap` (y los
 *   plugins, si los usa directamente) desde este archivo, nunca desde el
 *   paquete "gsap" a secas.
 *
 * Este archivo en sí no lleva "use client": es seguro de importar desde
 * cualquier lugar porque solo registra los plugins cuando hay `window`.
 * Sin embargo, en la práctica solo debería importarse desde Client
 * Components, ya que animar no tiene efecto en el servidor.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText);
}

export { gsap, ScrollTrigger, SplitText };
