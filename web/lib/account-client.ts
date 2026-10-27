import type { StoreLocale } from "../../shared/catalog.ts";

export type AccountMode = "password" | "code" | "register" | "reset";
export function accountCodeRequest(mode: AccountMode, channel: "email" | "phone", contact: Record<string, string>, captchaToken: string) {
  return { path: `${channel}/${mode === "register" ? "" : "login/"}send-code`,
    body: { ...contact, captcha_token: captchaToken, purpose: mode === "register" ? "register" : mode === "reset" ? "reset" : "login" } };
}
export class AccountClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const errors: Record<string, [string, string, string]> = {
  credentials_invalid: ["账号、密码或验证码错误。", "The account, password or code is incorrect.", "La cuenta, contraseña o código es incorrecto."],
  authentication_required: ["请重新登录。", "Please sign in again.", "Vuelve a iniciar sesión."],
  account_unavailable: ["账号暂不可用，请稍后重试。", "This account is unavailable. Please try again later.", "Esta cuenta no está disponible. Inténtalo más tarde."],
  account_changed: ["账号已变化，请重新登录后重试。", "Your account changed. Sign in again before retrying.", "Tu cuenta cambió. Vuelve a iniciar sesión."],
  account_conflict: ["该联系方式已被使用，请核对后重试。", "That contact is already in use. Check it and try again.", "Ese contacto ya está en uso. Revísalo e inténtalo de nuevo."],
  code_invalid: ["验证码错误或已过期，请重新获取。", "The verification code is incorrect or expired. Request a new code.", "El código es incorrecto o caducó. Solicita uno nuevo."],
  captcha_invalid: ["图片验证失败或已过期，请重新获取。", "Image verification failed or expired. Load a new image.", "La verificación falló o caducó. Carga otra imagen."],
  rate_limited: ["操作频繁，请稍后重试。", "Too many attempts. Please wait and try again.", "Demasiados intentos. Espera y vuelve a intentarlo."],
  cooldown: ["请稍候再请求验证码。", "Please wait before requesting another code.", "Espera antes de solicitar otro código."],
  password_invalid: ["密码至少 8 个字符，且不超过 72 个 UTF-8 字节。", "Use at least 8 characters and no more than 72 UTF-8 bytes.", "Usa al menos 8 caracteres y no más de 72 bytes UTF-8."],
  phone_invalid: ["请输入有效的国际区号和手机号。", "Enter a valid country calling code and phone number.", "Introduce un prefijo internacional y teléfono válidos."],
  email_invalid: ["请输入有效邮箱。", "Enter a valid email address.", "Introduce un correo válido."],
  reauthentication_required: ["请使用当前密码或已绑定联系方式再次验证。", "Verify again with your current password or a linked contact.", "Verifica de nuevo con tu contraseña o un contacto vinculado."],
  last_login_method: ["至少保留一种登录方式。", "Keep at least one sign-in method.", "Conserva al menos un método de acceso."],
};
export function accountErrorMessage(reason: unknown, locale: StoreLocale): string {
  if (reason instanceof AccountClientError) {
    const named = errors[reason.code];
    if (named) return named[locale === "zh" ? 0 : locale === "es" ? 2 : 1];
    if (locale !== "zh") return locale === "es" ? "No se pudo completar la solicitud. Revisa los datos o inténtalo más tarde." : "The request could not be completed. Check your details or try again later.";
  }
  return reason instanceof Error ? reason.message : locale === "zh" ? "未能完成，请稍后重试。" : locale === "es" ? "Inténtalo más tarde." : "Please try again later.";
}
