"use client";

import { useTransition } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { NavIcon } from "./NavIcon";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await logoutAction();
    });
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      className="flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-sm font-sans text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      <NavIcon name="logout" className="h-5 w-5 shrink-0" />
      {isPending ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  );
}
