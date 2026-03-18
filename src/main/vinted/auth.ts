import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";

// ─── Authentication ─────────────────────────────────────────────────────────

export async function login(domain?: string): Promise<{ success: boolean; userId: number | null }> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  return client.login();
}

export async function checkSession(domain?: string): Promise<{ loggedIn: boolean; userId: number | null }> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  return client.checkSession();
}

export async function logout(domain?: string): Promise<void> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  return client.logout();
}

export function getLoginStatus(domain?: string): { loggedIn: boolean; userId: number | null } {
  const client = getClient(domain || DEFAULT_DOMAIN);
  return { loggedIn: client.isLoggedIn, userId: client.userId };
}
