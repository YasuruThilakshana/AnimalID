const jwt = require("jsonwebtoken");

const RESET_TOKEN_TTL = "15m";
const RESET_TOKEN_PURPOSE = "password-reset";

function getJwtSecret() {
  return process.env.JWT_SECRET || "change-me-in-production";
}

function getClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

/**
 * Returns an error message when the password fails the reset policy
 * (min 8 chars, at least one letter and one number), or null when valid.
 */
function passwordResetError(password) {
  const pw = String(password || "");
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

/**
 * Per-user signing secret: binding the token to the current password hash
 * means any successful reset automatically invalidates older reset tokens.
 */
function resetSecretFor(user) {
  return `${getJwtSecret()}::${user.passwordHash}`;
}

function signResetToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, purpose: RESET_TOKEN_PURPOSE },
    resetSecretFor(user),
    { expiresIn: RESET_TOKEN_TTL },
  );
}

function verifyResetToken(token, user) {
  const payload = jwt.verify(token, resetSecretFor(user));
  if (!payload || payload.purpose !== RESET_TOKEN_PURPOSE) {
    throw new Error("Reset link is invalid or has expired.");
  }
  if (Number(payload.id) !== Number(user.id)) {
    throw new Error("Reset link is invalid or has expired.");
  }
  return payload;
}

/** Hash-router link (the app routes by location.hash, not paths). */
function buildResetLink(token) {
  return `${getClientUrl()}/#/reset-password/${encodeURIComponent(token)}`;
}

function resetEmailHtml(name, link) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;text-align:left;">
<tr><td style="font-size:20px;font-weight:bold;color:#0a2320;">AnimalID</td></tr>
<tr><td style="padding-top:16px;font-size:15px;color:#292524;">${greeting}</td></tr>
<tr><td style="padding-top:8px;font-size:15px;color:#292524;">We received a request to reset your password. Click the button below to choose a new one. This link expires in <strong>15 minutes</strong>.</td></tr>
<tr><td align="center" style="padding:24px 0;">
<a href="${link}" style="display:inline-block;background:#e4572e;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:8px;">Reset my password</a>
</td></tr>
<tr><td style="font-size:13px;color:#78716c;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${link}" style="color:#1f5c52;word-break:break-all;">${link}</a></td></tr>
<tr><td style="padding-top:16px;font-size:13px;color:#78716c;">Didn't ask for this? You can safely ignore this email — your password won't change.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function createMailTransport(nodemailer) {
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    const err = new Error("Email service is not configured. Set EMAIL_USER and EMAIL_PASS.");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const mailer = nodemailer || require("nodemailer");
  return mailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

async function sendResetEmail({ to, name, link }, { transport, nodemailer } = {}) {
  const active = transport || createMailTransport(nodemailer);
  await active.sendMail({
    from: `"AnimalID" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Reset your AnimalID password",
    html: resetEmailHtml(name, link),
  });
}

module.exports = {
  RESET_TOKEN_TTL,
  RESET_TOKEN_PURPOSE,
  getClientUrl,
  isValidEmail,
  passwordResetError,
  signResetToken,
  verifyResetToken,
  buildResetLink,
  resetEmailHtml,
  createMailTransport,
  sendResetEmail,
};
