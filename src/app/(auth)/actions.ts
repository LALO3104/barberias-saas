"use server";

import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";

// ─── Login ─────────────────────────────────────────────────────────────────

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Ingresa tu correo y contraseña." };
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return { error: "Error de configuración del servidor. Intenta más tarde." };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Mapear errores de Supabase a mensajes amigables
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Correo o contraseña incorrectos." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Tu correo no ha sido confirmado. Revisa tu bandeja de entrada." };
    }
    if (error.message.includes("Too many requests")) {
      return { error: "Demasiados intentos. Espera unos minutos antes de intentar de nuevo." };
    }
    return { error: "No se pudo iniciar sesión. Intenta de nuevo." };
  }

  redirect("/dashboard");
}

// ─── Forgot Password ──────────────────────────────────────────────────────

export interface ForgotPasswordState {
  error?: string;
  success?: boolean;
}

export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Ingresa tu correo electrónico." };
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return { error: "Error de configuración del servidor. Intenta más tarde." };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback?next=/reset-password`,
  });

  if (error) {
    if (error.message.includes("Too many requests")) {
      return { error: "Demasiados intentos. Espera unos minutos." };
    }
    // No revelar si el email existe o no (seguridad)
    return { success: true };
  }

  return { success: true };
}

// ─── Reset Password ────────────────────────────────────────────────────────

export interface ResetPasswordState {
  error?: string;
  success?: boolean;
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password) {
    return { error: "Ingresa tu nueva contraseña." };
  }

  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
  }

  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return { error: "Error de configuración del servidor. Intenta más tarde." };
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    if (error.message.includes("same_password")) {
      return { error: "La nueva contraseña debe ser diferente a la actual." };
    }
    return { error: "No se pudo actualizar la contraseña. Intenta de nuevo." };
  }

  return { success: true };
}

// ─── Logout ────────────────────────────────────────────────────────────────

export async function logoutAction(): Promise<void> {
  const supabase = await getSupabaseServer();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/login");
}
