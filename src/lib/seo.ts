import type { Metadata } from "next";
import type { TenantContent } from "@/types/content";

/**
 * Construye el `Metadata` de la landing pública a partir del contenido de
 * un tenant. No sabe nada de Kings en particular — cuando exista una
 * segunda barbería, se llama igual con su propio TenantContent.
 */
export function buildTenantMetadata(content: TenantContent): Metadata {
  const title = `${content.tenant.name} — ${content.hero.title}`;
  const description = content.valueProposition.body;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}
