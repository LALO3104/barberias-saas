import type { MetadataRoute } from "next";

/** Las páginas públicas se indexan; el panel y el acceso del personal no. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/login", "/forgot-password", "/reset-password", "/auth", "/invitacion", "/api"],
    },
  };
}
