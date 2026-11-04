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

// ─── Invitación de barbero ─────────────────────────────────────────────────

export interface InviteState {
  error?: string;
}

const INVITE_TOKEN_RE = /^[0-9a-f]{64}$/;
const INVALID_INVITE = "Esta invitación ya no es válida. Pide un enlace nuevo al administrador.";

/**
 * Crea la cuenta (o entra con una existente) y la liga al barbero de la
 * invitación. El token es lo que autoriza: sin él, una cuenta nueva no tiene
 * acceso a ninguna barbería.
 */
export async function acceptInviteAction(
  _prevState: InviteState,
  formData: FormData
): Promise<InviteState> {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();

  if (!INVITE_TOKEN_RE.test(token)) return { error: INVALID_INVITE };
  if (!email || email.length > 254) return { error: "Escribe tu correo electrónico." };
  if (password.length < 8 || password.length > 72) {
    return { error: "La contraseña debe tener de 8 a 72 caracteres." };
  }
  if (!whatsapp || whatsapp.length > 30) return { error: "Escribe tu WhatsApp." };

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return { error: "Error de configuración del servidor. Intenta más tarde." };
  }

  const { data: invite, error: inviteError } = await supabase.rpc("get_barber_invite", { _token: token });
  if (inviteError || !invite) return { error: INVALID_INVITE };
  const barberName = (invite as { barber_name?: string }).barber_name;

  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: barberName } },
  });

  if (signUpError && !signUpError.message.includes("already registered")) {
    if (signUpError.message.includes("rate limit") || signUpError.status === 429) {
      return { error: "Demasiados intentos. Espera unos minutos." };
    }
    if (signUpError.code === "weak_password") {
      return { error: "Esa contraseña es muy débil. Usa otra." };
    }
    if (signUpError.code === "validation_failed" || signUpError.code === "email_address_invalid") {
      return { error: "Ese correo no es válido." };
    }
    return { error: "No se pudo crear tu cuenta. Intenta de nuevo." };
  }

  // Sin sesión: el correo ya tenía cuenta, o Supabase pide confirmar el correo.
  if (!signUp?.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (signInError.message.includes("Email not confirmed")) {
        return { error: "Tu cuenta quedó pendiente de confirmar. Avisa al administrador." };
      }
      return { error: "Ese correo ya tiene cuenta y la contraseña no coincide." };
    }
  }

  const { error: acceptError } = await supabase.rpc("accept_barber_invite", {
    _token: token,
    _whatsapp: whatsapp,
  });

  if (acceptError) {
    switch (acceptError.code) {
      case "23514":
        return { error: acceptError.message };
      case "BA014":
        return { error: "Esa cuenta ya pertenece a esta barbería, o este barbero ya tiene acceso." };
      case "P0002":
        return { error: INVALID_INVITE };
      default:
        return { error: "No se pudo activar tu cuenta. Intenta de nuevo." };
    }
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
