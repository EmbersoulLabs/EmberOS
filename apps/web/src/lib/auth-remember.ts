const REMEMBER_KEY = "emberos.auth.remember";
const EMAIL_KEY = "emberos.auth.email";
const PASSWORD_KEY = "emberos.auth.password";

export interface RememberedCredentials {
  email: string;
  password: string;
  remember: boolean;
}

export function loadRememberedCredentials(): RememberedCredentials | null {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem(REMEMBER_KEY) !== "1") return null;
  const email = localStorage.getItem(EMAIL_KEY) ?? "";
  const password = localStorage.getItem(PASSWORD_KEY) ?? "";
  if (!email) return null;
  return { email, password, remember: true };
}

export function saveRememberedCredentials(email: string, password: string): void {
  localStorage.setItem(REMEMBER_KEY, "1");
  localStorage.setItem(EMAIL_KEY, email);
  localStorage.setItem(PASSWORD_KEY, password);
}

export function clearRememberedCredentials(): void {
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(PASSWORD_KEY);
}
