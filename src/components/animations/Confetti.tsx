"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  tilt: number;
  tiltSpeed: number;
  color: string;
  alpha: number;
  shape: "rect" | "circle";
}

const GRAVITY = 0.32;
const DRAG = 0.985;
const MAX_MS = 3800;

/**
 * Lluvia de confeti de celebración (una sola vez, al montar). Canvas a
 * pantalla completa, sin capturar toques. Colores de los tokens
 * (--color-accent, --color-foreground). Con "reducir movimiento" no se dibuja.
 * Momento de celebración poco frecuente: aquí sí cabe el "delight".
 */
export function Confetti({ count = 140 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--color-accent").trim() || "#c6a15b";
    const foreground = styles.getPropertyValue("--color-foreground").trim() || "#f5f5f5";
    const palette = [accent, accent, accent, foreground];

    const w = window.innerWidth;
    const h = window.innerHeight;
    // Dos "cañones" desde las esquinas inferiores, hacia el centro.
    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const angle = ((fromLeft ? -62 : -118) + (Math.random() - 0.5) * 34) * (Math.PI / 180);
      const speed = Math.min(h, 900) * (0.022 + Math.random() * 0.018);
      return {
        x: fromLeft ? -8 : w + 8,
        y: h * 0.82,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        tilt: Math.random() * Math.PI,
        tiltSpeed: 0.08 + Math.random() * 0.12,
        color: palette[Math.floor(Math.random() * palette.length)],
        alpha: 0.75 + Math.random() * 0.25,
        shape: Math.random() < 0.25 ? "circle" : "rect",
      };
    });

    let frame = 0;
    const start = performance.now();
    let last = start;

    const tick = (now: number) => {
      // Paso normalizado a 60 fps: misma física en pantallas de 120 Hz.
      const step = Math.min((now - last) / 16.67, 3);
      last = now;
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);

      let alive = 0;
      for (const p of particles) {
        p.vx *= Math.pow(DRAG, step);
        p.vy = p.vy * Math.pow(DRAG, step) + GRAVITY * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.rotation += p.spin * step;
        p.tilt += p.tiltSpeed * step;
        if (p.y > h + 20) continue;
        alive++;

        // Se desvanece en el último tercio de vida.
        const fade = elapsed > MAX_MS * 0.66 ? Math.max(0, 1 - (elapsed - MAX_MS * 0.66) / (MAX_MS * 0.34)) : 1;
        ctx.save();
        ctx.globalAlpha = p.alpha * fade;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.38, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // El "volteo" del papel: se aplana con el coseno de la inclinación.
          ctx.scale(1, Math.cos(p.tilt));
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        }
        ctx.restore();
      }

      if (alive > 0 && elapsed < MAX_MS) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [count, reduceMotion]);

  if (reduceMotion) return null;
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}
