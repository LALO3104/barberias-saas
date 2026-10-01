import type { TenantContent } from "@/types/content";

/**
 * ============================================================
 * CONTENIDO DEMO — Barbería Kings
 * ============================================================
 * Barbería Kings todavía no nos ha dado su contenido real. Todo lo que hay
 * en este archivo es de EJEMPLO, pensado únicamente para maquetar y probar
 * la interfaz — no son datos confirmados.
 *
 * En particular, precios, nombres de barberos, dirección, teléfono,
 * horarios y redes sociales están marcados como "(demo)" / "por
 * confirmar" tanto en el código como en lo que se renderiza en pantalla,
 * para que no se puedan confundir con información real más adelante.
 *
 * Este es el ÚNICO archivo del proyecto que sabe que existe una barbería
 * llamada "Kings" — ningún componente en components/ lo importa.
 *
 * Cuando exista el contenido real, se reemplaza este archivo (o se agrega
 * uno nuevo en data/tenants/ para otra barbería con la misma forma,
 * TenantContent) sin tocar ningún componente.
 */

// Centralizado aquí: Navbar y BookingCta apuntan a este mismo valor. No hay
// sistema de reservas todavía, así que el CTA navega dentro de la misma
// landing en vez de a una ruta real. Cuando exista /reservar, se cambia
// solo esta línea.
const bookingHref = "#reservar";

export const kingsTenant: TenantContent = {
  tenant: {
    id: "kings",
    slug: "kings",
    name: "Barbería Kings",
  },

  bookingHref,

  nav: [
    { label: "Servicios", href: "#servicios" },
    { label: "Barberos", href: "#barberos" },
    { label: "Galería", href: "#galeria" },
    { label: "Horarios", href: "#horarios" },
  ],

  hero: {
    eyebrow: "Barbería Kings — vista previa",
    title: "Precisión clásica, actitud moderna",
    subtitle:
      "Texto de ejemplo para probar la jerarquía editorial del Hero. Se reemplaza con el mensaje real de Kings.",
    primaryCta: { label: "Reservar cita", href: bookingHref },
    secondaryCta: { label: "Ver servicios", href: "#servicios" },
  },

  valueProposition: {
    eyebrow: "La experiencia",
    title: "Más que un corte",
    body: "Párrafo de ejemplo para maquetar esta sección — describe en un par de líneas la propuesta de valor real de la barbería una vez que la tengamos.",
    pillars: [
      {
        title: "Pilar de ejemplo 1",
        description: "Texto de ejemplo para esta tarjeta.",
      },
      {
        title: "Pilar de ejemplo 2",
        description: "Texto de ejemplo para esta tarjeta.",
      },
      {
        title: "Pilar de ejemplo 3",
        description: "Texto de ejemplo para esta tarjeta.",
      },
    ],
  },

  servicesSection: {
    eyebrow: "Servicios",
    title: "Lo que ofrecemos",
  },

  services: [
    {
      id: "corte-clasico",
      name: "Corte clásico",
      description:
        "Texto de ejemplo para esta tarjeta de servicio — se reemplaza con la descripción real.",
      price: "$XX (demo)",
      duration: "XX min (demo)",
    },
    {
      id: "arreglo-barba",
      name: "Arreglo de barba",
      description:
        "Texto de ejemplo para esta tarjeta de servicio — se reemplaza con la descripción real.",
      price: "$XX (demo)",
      duration: "XX min (demo)",
    },
    {
      id: "afeitado-premium",
      name: "Afeitado premium",
      description:
        "Texto de ejemplo para esta tarjeta de servicio — se reemplaza con la descripción real.",
      price: "$XX (demo)",
      duration: "XX min (demo)",
    },
  ],

  barbersSection: {
    eyebrow: "El equipo",
    title: "Barberos",
  },

  barbers: [
    {
      id: "barbero-demo-1",
      name: "Barbero Demo 1",
      role: "Puesto por confirmar (demo)",
      bio: "Biografía de ejemplo — texto pendiente de reemplazar con la información real.",
      photo: { alt: "Barbero Demo 1 — foto pendiente" },
    },
    {
      id: "barbero-demo-2",
      name: "Barbero Demo 2",
      role: "Puesto por confirmar (demo)",
      bio: "Biografía de ejemplo — texto pendiente de reemplazar con la información real.",
      photo: { alt: "Barbero Demo 2 — foto pendiente" },
    },
    {
      id: "barbero-demo-3",
      name: "Barbero Demo 3",
      role: "Puesto por confirmar (demo)",
      bio: "Biografía de ejemplo — texto pendiente de reemplazar con la información real.",
      photo: { alt: "Barbero Demo 3 — foto pendiente" },
    },
  ],

  gallerySection: {
    eyebrow: "Galería",
    title: "El espacio",
  },

  gallery: [
    { id: "galeria-1", alt: "Espacio de la barbería — imagen de ejemplo" },
    { id: "galeria-2", alt: "Estación de corte — imagen de ejemplo" },
    { id: "galeria-3", alt: "Detalle de herramientas — imagen de ejemplo" },
    { id: "galeria-4", alt: "Zona de espera — imagen de ejemplo" },
    { id: "galeria-5", alt: "Producto de barbería — imagen de ejemplo" },
    { id: "galeria-6", alt: "Ambiente general — imagen de ejemplo" },
  ],

  hoursLocationSection: {
    eyebrow: "Visítanos",
    title: "Horarios y ubicación",
  },

  hours: [
    { day: "Lunes – Viernes", hours: "Horario por confirmar (demo)" },
    { day: "Sábado", hours: "Horario por confirmar (demo)" },
    { day: "Domingo", hours: "Cerrado (demo)" },
  ],

  location: {
    addressLine: "Dirección por confirmar (demo)",
    phone: "Teléfono por confirmar (demo)",
  },

  bookingCta: {
    eyebrow: "Reserva tu cita",
    title: "Vive la experiencia Kings",
    body: "Texto de ejemplo para este bloque final — el botón ya está preparado para conectarse al sistema de reservas real más adelante.",
    cta: { label: "Reservar cita", href: bookingHref },
  },

  footer: {
    tagline: "Barbería Kings — contenido de muestra, pendiente de confirmar.",
    socialLinks: [
      { label: "Instagram (demo)", href: "#" },
      { label: "Facebook (demo)", href: "#" },
    ],
  },
};
