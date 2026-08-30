const REMEMBER_KEY = "emberos.auth.remember";
const EMAIL_KEY = "emberos.auth.email";
const PASSWORD_KEY = "emberos.auth.password";

export interface RememberedCredentials {
  email: string;
  remember: boolean;
}

/** Remove the legacy plaintext credential without changing identifier preference. */
export function removeLegacyRememberedPassword(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PASSWORD_KEY);
}

export function loadRememberedCredentials(): RememberedCredentials | null {
  if (typeof window === "undefined") return null;
  removeLegacyRememberedPassword();
  if (localStorage.getItem(REMEMBER_KEY) !== "1") return null;
  const email = localStorage.getItem(EMAIL_KEY) ?? "";
  if (!email) return null;
  return { email, remember: true };
}

export function saveRememberedCredentials(email: string): void {
  removeLegacyRememberedPassword();
  localStorage.setItem(REMEMBER_KEY, "1");
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearRememberedCredentials(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem(EMAIL_KEY);
  removeLegacyRememberedPassword();
}
