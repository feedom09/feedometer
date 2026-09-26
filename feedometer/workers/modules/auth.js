/**
 * workers/modules/auth.js — Enterprise Identity Subsystem (7-Domain Architecture)
 * Cloudflare D1 Relational Engine
 *
 * Modular ES6 facade / barrel export delegating to dedicated domain modules:
 *   - lib/session.js        (Session verification middleware)
 *   - lib/audit.js          (Audit logging & client info extraction)
 *   - auth/credentials.js   (Register, Login, Logout)
 *   - auth/google.js        (Google OAuth federation)
 *   - auth/sessions.js      (Session listing & revocation)
 *   - auth/preferences.js   (Profile, Password, Preferences, Account Deletion)
 */

export { verifySessionToken } from '../lib/session.js';
export { getClientInfo, logAudit } from '../lib/audit.js';

export {
  handleRegister,
  handleLogin,
  handleLogout,
  handleForgotPassword,
  handleVerifyEmail,
  handleVerifyResetToken,
  handleResetPassword,
  SESSION_TTL_DAYS,
  SESSION_TTL_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  RESET_TOKEN_TTL_MS
} from './auth/credentials.js';

export {
  verifyGoogleAccessToken,
  handleGoogleAuth
} from './auth/google.js';

export {
  handleListSessions,
  handleRevokeSession,
  handleRevokeOtherSessions
} from './auth/sessions.js';

export {
  handleMe,
  handleProfileUpdate,
  handlePasswordChange,
  handleGetPreferences,
  handleUpdatePreferences,
  handleDeleteAccount
} from './auth/preferences.js';
