export type StoredAuth = {
  accessToken: string;
  userId: string;
  deviceId: string;
};

const SESSION_KEY = "matrix_auth_session_v2";
const LEGACY_KEY = "matrix_auth_v1";

function parseStoredAuth(raw: string | null): StoredAuth | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function readAuth(): StoredAuth | null {
  const sessionAuth = parseStoredAuth(window.sessionStorage.getItem(SESSION_KEY));
  if (sessionAuth) return sessionAuth;

  const legacyAuth = parseStoredAuth(window.localStorage.getItem(LEGACY_KEY));
  if (!legacyAuth) return null;

  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(legacyAuth));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignore storage failures and still return the recovered auth.
  }

  return legacyAuth;
}

export function writeAuth(auth: StoredAuth): void {
  const raw = JSON.stringify(auth);
  window.sessionStorage.setItem(SESSION_KEY, raw);
  window.localStorage.removeItem(LEGACY_KEY);
}

export function clearAuth(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
}
