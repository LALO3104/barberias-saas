/**
 * Forma de los datos para el futuro soporte multi-tenant (una sola
 * instancia de la plataforma atendiendo a varias barberías, cada una con
 * sus propios datos aislados).
 *
 * Esto es solo el tipo: cómo se resuelve el tenant en cada request
 * (subdominio, slug en la URL, header, etc.) y las consultas reales contra
 * Supabase se definen más adelante, cuando exista el esquema de base de
 * datos. Ver ARCHITECTURE.md.
 */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
}
