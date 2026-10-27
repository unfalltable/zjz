"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, Globe2, LogOut, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useStoreLocale } from "@/hooks/use-storefront";
import { AccountClientError, accountCodeRequest, accountErrorMessage, type AccountMode } from "@/lib/account-client";
import "./customer-account.css";

type User = { user_id: string; nickname: string | null; email: string | null; backup_email?: string | null; phone: string | null; phone_country_code?: string | null; avatar_url: string | null; has_google?: boolean; has_apple?: boolean };
type Capabilities = { email: boolean; sms: boolean; google: boolean; apple: boolean; password: boolean; avatar?: boolean };
type Captcha = { captcha_id: string; image: string; expires_in: number };
type Reply<T> = { success: boolean; message?: string; data: T };
type Mode = AccountMode;
async function api<T>(path: string, body?: object | FormData, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/account/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: body instanceof FormData || body === undefined ? undefined : { "Content-Type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => null) as (Reply<T> & { code?: string }) | null;
  if (!response.ok || !result?.success) throw new AccountClientError(result?.code ?? "account_unavailable", result?.message ?? "Account service is unavailable. Please try again.");
  return result.data;
}

export function CustomerAccount() {
  const [locale, setLocale] = useStoreLocale();
  const tr = (zh: string, en: string, es: string) => locale === "zh" ? zh : locale === "es" ? es : en;
  const [mode, setMode] = useState<Mode>("password");
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [account, setAccount] = useState("");
  const [contactKind, setContactKind] = useState<"email" | "phone">("email");
  const [countryCode, setCountryCode] = useState("+1");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [nickname, setNickname] = useState("");
  const summary = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setFailure("");
    Promise.all([api<Capabilities>("config", undefined, controller.signal), api<User>("me", {}, controller.signal).catch(() => null)])
      .then(([config, current]) => { if (!controller.signal.aborted) { setCapabilities(config); setUser(current); setNickname(current?.nickname ?? ""); } })
      .catch(reason => { if (!controller.signal.aborted) { setCapabilities(null); setFailure(reason instanceof Error ? reason.message : "Account unavailable."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => { if (failure) summary.current?.focus(); }, [failure]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);
  function clearChallenge() { setCaptcha(null); setCaptchaAnswer(""); }
  function changeMode(next: Mode) { setMode(next); setFailure(""); setNotice(""); setPassword(""); setVerificationCode(""); clearChallenge(); }
  const contactSupported = contactKind === "email" ? capabilities?.email : capabilities?.sms;
  const enabled = Boolean(capabilities && !loading);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setFailure(""); setNotice("");
    try { await work(); } catch (reason) { if (mounted.current) setFailure(accountErrorMessage(reason, locale)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function loadCaptcha() {
    await run(async () => {
      const result = await api<Captcha>("captcha/image", {});
      if (!result.captcha_id || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.image) || result.image.length > 500000) throw new Error("Invalid verification image. Please reload.");
      setCaptcha(result); setCaptchaAnswer("");
    });
  }
  async function verifiedCaptcha() {
    if (!captcha || !captchaAnswer.trim()) throw new Error(tr("请先获取并完成验证码。", "Load and complete the verification image first.", "Carga y completa la imagen de verificación."));
    try { const data = await api<{ captcha_token: string }>("captcha/image/verify", { captcha_id: captcha.captcha_id, code: captchaAnswer.trim() }); if (!data.captcha_token) throw new Error("Verification expired."); return data.captcha_token; }
    finally { clearChallenge(); }
  }
  function contact(): Record<string, string> { return contactKind === "email" ? { email: account.trim() } : { phone: account.trim(), phone_country_code: countryCode.trim() }; }
  async function sendCode() {
    await run(async () => {
      if (!account.trim()) throw new Error(tr("先填写邮箱或手机号。", "Enter your email or phone first.", "Introduce primero tu correo o teléfono."));
      const captcha_token = await verifiedCaptcha();
      const codeRequest = accountCodeRequest(mode, contactKind, contact(), captcha_token);
      await api(codeRequest.path, codeRequest.body);
      setCooldown(60); setNotice(tr("验证码请求已受理，请检查收件箱或短信。", "Code requested. Check your inbox or messages.", "Código solicitado. Revisa el correo o los mensajes."));
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (mode === "reset") {
        await api("password/reset", { account: account.trim(), code: verificationCode.trim(), new_password: password, phone_country_code: countryCode });
        changeMode("password"); setNotice(tr("密码已重设，请重新登录。", "Password reset. Sign in with your new password.", "Contraseña restablecida. Vuelve a iniciar sesión.")); return;
      }
      if (mode === "password") await api("login/password", { account: account.trim(), password, phone_country_code: countryCode.trim(), captcha_token: await verifiedCaptcha() });
      else if (mode === "register") await api(`${contactKind}/register`, { ...contact(), password, code: verificationCode.trim() });
      else await api(`login/${contactKind}/code`, { ...contact(), code: verificationCode.trim() });
      setPassword(""); setVerificationCode(""); clearChallenge();
      const current = await api<User>("me", {}); setUser(current); setNickname(current.nickname ?? "");
      setNotice(tr("已登录。", "You are signed in.", "Has iniciado sesión."));
    });
  }
  return <main className="customer-account-shell"><header className="customer-account-header"><a href="/" className="customer-account-back"><ArrowLeft aria-hidden="true" />{tr("继续购物", "Continue shopping", "Seguir comprando")}</a><label><Globe2 aria-hidden="true" /><span className="sr-only">{tr("语言", "Language", "Idioma")}</span><select value={locale} onChange={event => setLocale(event.target.value as typeof locale)} aria-label={tr("语言", "Language", "Idioma")}><option value="en">English</option><option value="zh">简体中文</option><option value="es">Español</option></select></label></header>
    <div className={`customer-account-content ${user ? "signed-in" : ""}`}>
      <section className="customer-account-panel" aria-labelledby="customer-account-title"><div className="customer-account-heading"><UserRound aria-hidden="true" /><div><h1 id="customer-account-title">{user ? tr("我的账户", "Your account", "Tu cuenta") : mode === "register" ? tr("创建账户", "Create an account", "Crear una cuenta") : mode === "reset" ? tr("找回密码", "Reset your password", "Restablecer contraseña") : tr("欢迎回来", "Welcome back", "Te damos la bienvenida")}</h1><p>{user ? tr("管理你的资料和登录安全。", "Manage your profile and sign-in security.", "Gestiona tu perfil y la seguridad de acceso.") : tr("登录后管理账户，购物袋中的商品会保留。", "Sign in to manage your account. Your shopping bag stays as it is.", "Accede a tu cuenta. Tu bolsa de compra se conserva.")}</p></div></div>
        {loading && <p role="status">{tr("正在连接账号服务…", "Connecting to account service…", "Conectando con el servicio de cuentas…")}</p>}
        {failure && <p className="customer-account-feedback error" ref={summary} tabIndex={-1} role="alert">{failure}</p>}
        {notice && <p className="customer-account-feedback success" role="status">{notice}</p>}
        {!loading && !capabilities && <div className="customer-account-unavailable"><h2>{tr("账号服务暂不可用", "Accounts are temporarily unavailable", "Las cuentas no están disponibles")}</h2><p>{tr("商城浏览和购物袋仍可使用。请稍后重试。", "You can still browse and use your shopping bag. Please try again later.", "Puedes seguir navegando y usar la bolsa. Inténtalo más tarde.")}</p><button type="button" className="customer-account-secondary" onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />{tr("重新连接", "Reconnect", "Reconectar")}</button></div>}
        {capabilities && !user && <>
          <nav className="customer-account-tabs" aria-label={tr("登录方式", "Sign-in method", "Método de acceso")}><button type="button" disabled={busy} aria-current={mode === "password" ? "page" : undefined} onClick={() => changeMode("password")}>{tr("密码登录", "Password", "Contraseña")}</button><button type="button" disabled={busy} aria-current={mode === "code" ? "page" : undefined} onClick={() => changeMode("code")}>{tr("验证码登录", "Verification code", "Código")}</button></nav>
          <form onSubmit={submit} className="customer-account-form"><fieldset disabled={!enabled || busy}>
            {mode !== "password" && <label>{tr("联系方式", "Contact method", "Método de contacto")}<select value={contactKind} onChange={event => { setContactKind(event.target.value as "email" | "phone"); setAccount(""); setVerificationCode(""); clearChallenge(); }}><option value="email">{tr("邮箱", "Email", "Correo")}</option><option value="phone">{tr("手机号", "Phone", "Teléfono")}</option></select></label>}
            <label>{mode === "password" ? tr("邮箱或手机号", "Email or phone", "Correo o teléfono") : contactKind === "email" ? tr("邮箱", "Email", "Correo") : tr("手机号", "Phone number", "Número de teléfono")}<input type={mode !== "password" && contactKind === "email" ? "email" : "text"} name="account" autoComplete={mode === "password" ? "username" : contactKind === "email" ? "email" : "tel-national"} required maxLength={320} value={account} onChange={event => { setAccount(event.target.value); setVerificationCode(""); }} /></label>
            {(contactKind === "phone" || (mode === "password" && account && !account.includes("@"))) && <label>{tr("国家电话区号", "Country calling code", "Prefijo del país")}<input name="phone_country_code" autoComplete="tel-country-code" value={countryCode} onChange={event => setCountryCode(event.target.value)} pattern="\+?[0-9]{1,4}" required maxLength={5} placeholder="+1" /></label>}
            {mode !== "code" && <label>{mode === "password" ? tr("密码", "Password", "Contraseña") : tr("新密码", "New password", "Nueva contraseña")}<span className="customer-password-control"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "password" ? "current-password" : "new-password"} minLength={mode === "password" ? 1 : 8} maxLength={72} required value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? tr("隐藏密码", "Hide password", "Ocultar contraseña") : tr("显示密码", "Show password", "Mostrar contraseña")}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></span></label>}
            {mode !== "password" && <><label>{tr("收到的验证码", "Verification code", "Código de verificación")}<input name="code" autoComplete="one-time-code" inputMode="numeric" value={verificationCode} required pattern="[0-9]{4,8}" maxLength={8} onChange={event => setVerificationCode(event.target.value)} /></label>{!contactSupported && <p className="customer-account-feedback" role="note">{contactKind === "email" ? tr("邮件发送服务尚未配置，暂不能注册、接收验证码或找回密码。", "Email delivery is not configured. Registration, email codes and password recovery are unavailable.", "El correo no está configurado. El registro, los códigos y la recuperación no están disponibles.") : tr("短信服务尚未配置，请使用邮箱或密码登录。", "SMS is not configured. Use email or password sign-in.", "SMS no está configurado. Usa correo o contraseña.")}</p>}</>}
            <div className="customer-captcha"><button type="button" className="customer-account-secondary" onClick={loadCaptcha} disabled={mode !== "password" && !contactSupported}>{captcha ? tr("更换验证图片", "New verification image", "Nueva imagen") : tr("获取验证图片", "Load verification image", "Cargar imagen")}</button>{captcha && <><img src={captcha.image} alt={tr("输入图片中显示的字符", "Enter the characters shown in the image", "Introduce los caracteres de la imagen")} width={180} height={60} /><label>{tr("图片验证码", "Image verification code", "Código de la imagen")}<input name="captcha_answer" autoComplete="off" value={captchaAnswer} maxLength={16} onChange={event => setCaptchaAnswer(event.target.value)} /></label></>}</div>
            {mode !== "password" && <button type="button" className="customer-account-secondary" onClick={sendCode} disabled={!contactSupported || !captcha || !captchaAnswer || cooldown > 0}>{cooldown > 0 ? `${cooldown}s` : tr("发送验证码", "Send code", "Enviar código")}</button>}
            <button className="customer-account-primary" type="submit" disabled={mode === "password" ? !captcha || !captchaAnswer : !contactSupported}>{busy ? tr("处理中…", "Working…", "Procesando…") : mode === "register" ? tr("创建账户", "Create account", "Crear cuenta") : mode === "reset" ? tr("重设密码", "Reset password", "Restablecer contraseña") : tr("登录", "Sign in", "Iniciar sesión")}</button>
          </fieldset></form>
          <div className="customer-account-links"><button type="button" disabled={busy} onClick={() => changeMode(mode === "register" ? "password" : "register")}>{mode === "register" ? tr("已有账户？去登录", "Already have an account? Sign in", "¿Ya tienes cuenta? Inicia sesión") : tr("新用户？创建账户", "New here? Create an account", "¿Eres nuevo? Crea una cuenta")}</button><button type="button" disabled={busy} onClick={() => changeMode("reset")}>{tr("忘记密码", "Forgot password?", "¿Olvidaste la contraseña?")}</button></div>
          <div className="customer-account-social"><p>{tr("或使用第三方账户", "Or use a connected provider", "O usa un proveedor conectado")}</p>{(["google", "apple"] as const).map(provider => capabilities[provider] ? <a key={provider} className="customer-account-secondary" href={`/api/account/${provider}/login`}>{provider === "google" ? "Google" : "Apple"}</a> : <span key={provider} className="customer-account-provider-disabled">{provider === "google" ? "Google" : "Apple"} · {tr("未配置", "Not configured", "No configurado")}</span>)}</div>
        </>}
        {capabilities && user && <><dl className="customer-account-facts"><dt>{tr("账户编号", "Account ID", "ID de cuenta")}</dt><dd>{user.user_id}</dd><dt>{tr("邮箱", "Email", "Correo")}</dt><dd>{user.email || "—"}</dd><dt>{tr("手机号", "Phone", "Teléfono")}</dt><dd>{`${user.phone_country_code ?? ""} ${user.phone ?? "—"}`}</dd><dt>{tr("第三方账户", "Connected providers", "Proveedores conectados")}</dt><dd>{[user.has_google ? "Google" : "", user.has_apple ? "Apple" : ""].filter(Boolean).join(", ") || "—"}</dd></dl>
          <form className="customer-account-form" onSubmit={event => { event.preventDefault(); void run(async () => { await api("nickname", { nickname }); setUser({ ...user, nickname }); setNotice(tr("昵称已保存。", "Name saved.", "Nombre guardado.")); }); }}><fieldset disabled={busy}><label>{tr("昵称", "Display name", "Nombre visible")}<input autoComplete="nickname" name="nickname" value={nickname} maxLength={100} required onChange={event => setNickname(event.target.value)} /></label><button className="customer-account-primary" type="submit">{tr("保存昵称", "Save name", "Guardar nombre")}</button></fieldset></form>
          <section className="customer-account-avatar"><h2>{tr("头像", "Profile photo", "Foto de perfil")}</h2>{/^\/api\/account\/avatar\/files\/[a-f0-9]{32}\.webp$/.test(user.avatar_url ?? "") && <img src={user.avatar_url!} width={80} height={80} alt={tr("当前头像", "Current profile photo", "Foto actual")} />}{capabilities.avatar === false && <p>{tr("头像存储尚未配置。", "Profile photo storage is not configured.", "El almacenamiento de fotos no está configurado.")}</p>}<label>{tr("上传 JPEG、PNG 或 WebP，最大 5 MB", "Upload JPEG, PNG or WebP, up to 5 MB", "Sube JPEG, PNG o WebP, hasta 5 MB")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || capabilities.avatar === false} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void run(async () => { if (file.size > 5 * 1024 * 1024) throw new Error("Maximum image size is 5 MB."); const data = new FormData(); data.set("avatar", file); const result = await api<{ avatar_url: string }>("avatar", data); setUser({ ...user, avatar_url: result.avatar_url }); setNotice(tr("头像已更新。", "Profile photo updated.", "Foto actualizada.")); }); }} /></label></section>
          <PasswordChange disabled={busy} locale={locale} run={run} onSaved={() => { setUser(null); setNotice(tr("密码已修改，所有旧会话已失效，请重新登录。", "Password changed. Previous sessions expired; sign in again.", "Contraseña cambiada. Las sesiones anteriores caducaron; vuelve a iniciar sesión.")); }} />
          <div className="customer-account-links"><a href="/track">{tr("查询订单", "Track an order", "Seguir un pedido")}</a><button type="button" disabled={busy} onClick={() => void run(async () => { await api("logout", {}); setUser(null); clearChallenge(); setNotice(tr("已退出登录。", "You are signed out.", "Has cerrado sesión.")); })}><LogOut aria-hidden="true" />{tr("退出登录", "Sign out", "Cerrar sesión")}</button></div>
        </>}
        <p className="customer-account-privacy"><ShieldCheck aria-hidden="true" />{tr("账号登录与后台管理员权限相互独立。", "Customer sign-in does not grant administrator access.", "Iniciar sesión como cliente no concede acceso de administrador.")}</p>
      </section>
    </div></main>;
}

function PasswordChange({ disabled, locale, run, onSaved }: { disabled: boolean; locale: string; run: (work: () => Promise<void>) => Promise<void>; onSaved: () => void }) {
  const zh = locale === "zh", es = locale === "es";
  const [oldPassword, setOldPassword] = useState(""); const [nextPassword, setNextPassword] = useState("");
  return <details className="customer-account-security"><summary>{zh ? "修改密码" : es ? "Cambiar contraseña" : "Change password"}</summary><form className="customer-account-form" onSubmit={event => { event.preventDefault(); void run(async () => { await api("password/change", { old_password: oldPassword, new_password: nextPassword }); setOldPassword(""); setNextPassword(""); onSaved(); }); }}><fieldset disabled={disabled}><label>{zh ? "当前密码" : es ? "Contraseña actual" : "Current password"}<input type="password" autoComplete="current-password" required maxLength={72} value={oldPassword} onChange={event => setOldPassword(event.target.value)} /></label><label>{zh ? "新密码" : es ? "Nueva contraseña" : "New password"}<input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={nextPassword} onChange={event => setNextPassword(event.target.value)} /></label><p>{zh ? "修改后需要重新登录。第三方登录且未设密码时，请使用验证码找回密码。" : es ? "Vuelve a iniciar sesión después del cambio. Usa la recuperación por código si aún no tienes contraseña." : "Sign in again after changing it. If you have not set a password, use code-based password recovery."}</p><button className="customer-account-primary" type="submit">{zh ? "保存新密码" : es ? "Guardar contraseña" : "Save new password"}</button></fieldset></form></details>;
}
