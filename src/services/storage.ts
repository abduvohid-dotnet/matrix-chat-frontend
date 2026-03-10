export type StoredAuth = {
  accessToken: string;
  userId: string;
  deviceId: string;
};

const KEY = "matrix_auth_v1";

export function readAuth(): StoredAuth | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
};

export function writeAuth(auth: StoredAuth): void {
  localStorage.setItem(KEY, JSON.stringify(auth));
};

export function clearAuth(): void {
  localStorage.removeItem(KEY);
};