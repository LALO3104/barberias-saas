import { redirect } from "next/navigation";

/**
 * La raíz lleva a la primera barbería. Cuando haya varias, aquí irá la página
 * del producto o un listado.
 */
export default function RootPage() {
  redirect("/charlys");
}
