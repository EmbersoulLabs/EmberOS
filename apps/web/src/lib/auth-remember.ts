const REMEMBER_KEY = "emberos.auth.remember";
const EMAIL_KEY = "emberos.auth.email";
/** Legacy key — cleared on read/write; passwords must never be stored client-side. */
const LEGACY_PASSWORD_KEY = "emberos.auth.password";

export interface RememberedCredentials {
  email: string;
  remember: boolean;
}

function clearLegacyPasswordStorage(): void {
  localStorage.removeItem(LEGACY_PASSWORD_KEY);
}

export function loadRememberedCredentials(): RememberedCredentials | null {
  if (typeof window === "undefined") return null;
  clearLegacyPasswordStorage();
  if (localStorage.getItem(REMEMBER_KEY) !== "1") return null;
  const email = localStorage.getItem(EMAIL_KEY) ?? "";
  if (!email) return null;
  return { email, remember: true };
}

export function saveRememberedCredentials(email: string): void {
  clearLegacyPasswordStorage();
  localStorage.setItem(REMEMBER_KEY, "1");
  localStorage.setItem(EMAIL_KEY, email.trim());
}

export function clearRememberedCredentials(): void {
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem(EMAIL_KEY);
  clearLegacyPasswordStorage();
}
