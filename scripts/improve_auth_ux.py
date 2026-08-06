from pathlib import Path

router_path = Path("src/router.tsx")
source = router_path.read_text(encoding="utf-8")

# Add password visibility icons once.
if "  Eye,\n" not in source:
    source = source.replace("  FileText,\n", "  Eye,\n  EyeOff,\n  FileText,\n", 1)

# Add visibility state once.
state_anchor = '  const [email, setEmail] = useState("");\n'
state_insert = (
    state_anchor
    + '  const [showPassword, setShowPassword] = useState(false);\n'
    + '  const [showNewPassword, setShowNewPassword] = useState(false);\n'
)
if "const [showPassword, setShowPassword]" not in source:
    if state_anchor not in source:
        raise SystemExit("Auth email state marker not found.")
    source = source.replace(state_anchor, state_insert, 1)

# Replace the current auth return with explicit labels, placeholders, and password controls.
start_token = '  return (\n    <div className="auth-shell">'
end_token = '  );\n}\n\nfunction contactName'
if start_token not in source or end_token not in source:
    raise SystemExit("Current auth component markers not found; refusing a broad edit.")
start = source.index(start_token)
end = source.index(end_token, start)
replacement = '''  return (
    <div className="auth-shell">
      <div className="auth-brand-pane">
        <Brand />
        <div className="auth-brand-copy">
          <span className="eyebrow dark"><ShieldCheck size={15} /> Secure customer portal</span>
          <h1>Control your domains from one dashboard.</h1>
          <p>Provider-backed availability, exact pricing and complete lifecycle controls.</p>
        </div>
        <div className="auth-points">
          <span><Check /> Protected account access</span>
          <span><Check /> USD wallet-only billing</span>
          <span><Check /> Domain lifecycle controls</span>
        </div>
      </div>
      <div className="auth-form-pane">
        <div className="auth-card">
          <Link to="/" className="back-link">← Back to domain search</Link>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setStep("form"); }}>Sign in</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setStep("form"); }}>Create account</button>
          </div>
          <h2>{mode === "login" ? "Sign in" : mode === "register" ? step === "form" ? "Create your account" : "Verify your email" : step === "form" ? "Reset your password" : "Enter the verification code"}</h2>
          <p>{mode === "login" ? "Enter the email and password linked to your account." : step === "form" ? "Complete the fields below. A six-digit verification code will be sent by email." : `Enter the code sent to ${email}.`}</p>
          <form className="form-stack" onSubmit={submit}>
            {step === "form" && <>
              <label>Email address
                <input name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" />
                <small>Use an address you can access for verification and password recovery.</small>
              </label>
              {mode === "register" && <>
                <label>Full name
                  <input name="fullName" required placeholder="First and last name" autoComplete="name" />
                </label>
                <div className="form-row auth-phone-row">
                  <label>Country code (ISO)
                    <input name="countryCode" maxLength={2} minLength={2} pattern="[A-Za-z]{2}" placeholder="CM" autoCapitalize="characters" />
                    <small>Two letters, for example CM.</small>
                  </label>
                  <label>Phone number
                    <input name="phone" type="tel" inputMode="tel" placeholder="+237 6 70 00 00 00" autoComplete="tel" />
                    <small>Include the international dialing prefix.</small>
                  </label>
                </div>
              </>}
              <label>Password
                <span className="password-field">
                  <input name="password" type={showPassword ? "text" : "password"} minLength={10} required placeholder="At least 10 characters" autoComplete={mode === "register" ? "new-password" : "current-password"} />
                  <button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
                <small>Use at least 10 characters.</small>
              </label>
            </>}
            {step === "otp" && <>
              <input type="hidden" name="email" value={email} />
              <label>Six-digit code<input name="code" className="otp-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required autoFocus /></label>
              {mode === "reset" && <label>New password
                <span className="password-field">
                  <input name="newPassword" type={showNewPassword ? "text" : "password"} minLength={10} required placeholder="At least 10 characters" autoComplete="new-password" />
                  <button type="button" className="password-toggle" aria-label={showNewPassword ? "Hide new password" : "Show new password"} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)}>
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>}
            </>}
            <button className="button button-primary button-wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : mode === "login" ? "Sign in" : step === "form" ? "Send verification code" : "Verify"}</button>
          </form>
          {error && <div className="alert alert-error">{errorText(error)}</div>}
          {mode === "login" && <button type="button" className="text-button" onClick={() => { setMode("reset"); setStep("form"); }}>Forgot password?</button>}
          {step === "otp" && <button type="button" className="text-button" onClick={() => setStep("form")}>Use a different email</button>}
        </div>
      </div>
    </div>
'''
source = source[:start] + replacement + source[end:]

# Clarify the WHOIS phone inputs too; DomainNameAPI expects the dialing code separately.
old_contact_phone = '<div className="form-row"><label>Phone country code<input name="phoneCountryCode" defaultValue={editing?.phone_country_code || "237"} required /></label><label>Phone<input name="phone" defaultValue={editing?.phone || ""} required /></label></div>'
new_contact_phone = '<div className="form-row contact-phone-row"><label>Dialing code<input name="phoneCountryCode" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} placeholder="237" defaultValue={editing?.phone_country_code || "237"} required /><small>Digits only, without the + sign.</small></label><label>Phone number<input name="phone" type="tel" inputMode="tel" placeholder="670000000" defaultValue={editing?.phone || ""} required /><small>Local number only.</small></label></div>'
if old_contact_phone in source:
    source = source.replace(old_contact_phone, new_contact_phone, 1)
elif "contact-phone-row" not in source:
    raise SystemExit("WHOIS contact phone fields marker not found.")

router_path.write_text(source, encoding="utf-8")

css_path = Path("src/router-compat.css")
css = css_path.read_text(encoding="utf-8")
marker = "/* Authentication field guidance and password visibility controls. */"
if marker not in css:
    css += '''

/* Authentication field guidance and password visibility controls. */
.auth-phone-row,
.contact-phone-row {
  grid-template-columns: minmax(130px, .42fr) minmax(220px, 1fr);
  align-items: start;
}
.password-field {
  position: relative;
  display: block;
  width: 100%;
}
.form-stack .password-field input {
  padding-right: 46px;
}
.password-toggle {
  width: 40px;
  height: 40px;
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #667085;
  background: transparent;
  cursor: pointer;
}
.password-toggle:hover,
.password-toggle:focus-visible {
  color: var(--blue);
  background: #edf4ff;
  outline: none;
}
.auth-card .form-stack label small,
.contact-phone-row label small {
  color: #7d8899;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.45;
}
@media (max-width: 560px) {
  .auth-phone-row,
  .contact-phone-row {
    grid-template-columns: 1fr;
  }
}
'''
css_path.write_text(css, encoding="utf-8")
