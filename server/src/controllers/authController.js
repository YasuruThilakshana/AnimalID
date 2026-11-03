const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  isValidEmail,
  passwordResetError,
  signResetToken,
  verifyResetToken,
  buildResetLink,
  sendResetEmail,
} = require("../utils/passwordReset");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

// HTTP-only session cookie: readable only by the server, so injected
// scripts can never steal the token (XSS mitigation). SameSite=Lax blocks
// cross-site cookie sends on mutations (CSRF mitigation); Secure rides
// along in production only, so plain-HTTP local dev keeps working.
const SESSION_COOKIE = "animalid_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches the JWT lifetime

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    joined: new Date(user.createdAt).getTime(),
  };
}

async function register(req, res, next) {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: "Please enter your full name." });
    }
    if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    // Upper bound keeps bcrypt hashing time predictable (huge passwords
    // would otherwise burn CPU per attempt — a cheap DoS vector).
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 6 and 128 characters." });
    }
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    const user = await User.create({
      name,
      email,
      passwordHash: await User.hashPassword(password),
    });
    await user.reload();
    const token = signToken(user);
    setSessionCookie(res, token);
    // The token stays in the body for non-browser API clients; browsers
    // authenticate via the HTTP-only cookie and must not store this.
    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.scope(null).findOne({ where: { email } });
    if (!user || !(await user.checkPassword(password))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const token = signToken(user);
    setSessionCookie(res, token);
    // The token stays in the body for non-browser API clients; browsers
    // authenticate via the HTTP-only cookie and must not store this.
    res.json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "Account not found." });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const user = await User.scope(null).findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "No account found with that email address." });
    }
    const token = signResetToken(user);
    const link = buildResetLink(token);
    try {
      await sendResetEmail({ to: user.email, name: user.name, link });
      console.log(`[auth] Password reset email sent to ${email}.`);
      return res.json({ message: "Password reset link sent. Check your inbox — it expires in 15 minutes." });
    } catch (err) {
      // Log the exact failure (missing credentials, SMTP auth/network error)
      // so it is diagnosable from server logs alone.
      console.error(
        `[auth] Password reset email to ${email} failed: ${err && err.message ? err.message : err} (code: ${(err && err.code) || "n/a"})`,
      );
      if (process.env.NODE_ENV !== "production") {
        // Local development fallback: email is often unconfigured here, so
        // hand the (still 15-minute, single-purpose) link back directly
        // instead of failing the request. Never sent in production.
        console.error(`[auth] Dev fallback reset link for ${email}: ${link}`);
        return res.json({
          message: "Email service is unavailable, so here is your development reset link (expires in 15 minutes).",
          devResetLink: link,
        });
      }
      return res.status(500).json({ error: "We couldn't send the reset email. Please try again in a few minutes." });
    }
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = String(req.params.token || "");
    if (!token) {
      return res.status(400).json({ error: "Reset link is missing or invalid." });
    }
    const decoded = jwt.decode(token);
    const user = decoded && decoded.id ? await User.scope(null).findByPk(decoded.id) : null;
    if (!user) {
      return res.status(400).json({ error: "Reset link is invalid or has expired." });
    }
    try {
      verifyResetToken(token, user);
    } catch {
      return res.status(400).json({ error: "Reset link is invalid or has expired." });
    }
    const complexityError = passwordResetError(req.body.password);
    if (complexityError) {
      return res.status(400).json({ error: complexityError });
    }
    // bcryptjs, salt factor 10 — same as registration. Because the reset
    // token is bound to the previous hash, saving here invalidates every
    // other outstanding reset token for this account.
    user.passwordHash = await User.hashPassword(String(req.body.password));
    await user.save();
    res.json({ message: "Your password has been reset. You can now sign in with your new password." });
  } catch (err) {
    next(err);
  }
}

function bearerToken(req) {
  const header = (req.headers && req.headers.authorization) || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireAuth(req, res, next) {
  // HTTP-only session cookie first (browser clients); the Authorization
  // header stays as a fallback for non-browser API clients.
  const token = (req.cookies && req.cookies[SESSION_COOKIE]) || bearerToken(req);
  if (!token) return res.status(401).json({ error: "Sign in required." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

/** POST /auth/logout — clear the session cookie. */
function logout(_req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

/**
 * Best-effort identity for public endpoints (photo scan): attaches the
 * verified JWT user when a valid token rides along, otherwise leaves
 * req.user unset. Never rejects — guests keep full access.
 */
function optionalAuth(req, _res, next) {
  const token = (req.cookies && req.cookies[SESSION_COOKIE]) || bearerToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      /* expired/forged token on a public endpoint — treat as guest */
    }
  }
  next();
}

module.exports = { register, login, me, logout, requireAuth, optionalAuth, forgotPassword, resetPassword, SESSION_COOKIE };
