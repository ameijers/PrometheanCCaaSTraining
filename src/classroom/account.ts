// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { BACKEND } from "../learn/client";

// Trainer sign-in (docs/classroom.md). On the hosted site, Azure Static Web Apps signs people in with a
// Microsoft account (/.auth/login/aad) and tells the backend who they are; the "trainer" role comes from an
// invitation in the Azure portal. On this computer there's no Static Web Apps, so signing in asks for a name
// and sends a made-up principal to the local backend (backend/src/server.ts), with the trainer and admin roles, so both can be tried here.

export interface Me { signedIn: boolean; name?: string; trainer: boolean; admin?: boolean }

const HOSTED = BACKEND === "/api";
const DEV_KEY = "ccaas-training.dev-principal";

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

// The same name gives the same made-up user id, so a local trainer finds their classes again.
function devUserId(name: string): string {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `local-${h.toString(16)}`;
}

function devPrincipal(): string | undefined {
  if (HOSTED) return undefined;
  try { return localStorage.getItem(DEV_KEY) ?? undefined; } catch { return undefined; }
}

// Headers for the backend: the local stand-in principal, if signed in on this computer.
export function accountHeaders(): Record<string, string> {
  const p = devPrincipal();
  return p ? { "X-Dev-Principal": p } : {};
}

export async function me(): Promise<Me> {
  try {
    const response = await fetch(`${BACKEND}/me`, { headers: accountHeaders() });
    return response.ok ? (await response.json()) as Me : { signedIn: false, trainer: false };
  } catch {
    return { signedIn: false, trainer: false };
  }
}

const home = () => `${window.location.origin}${window.location.pathname}?trainer=home`;

export function signIn(): void {
  if (HOSTED) {
    window.location.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(home())}`;
    return;
  }
  const name = window.prompt("Sign in on this computer (there's no Microsoft sign-in here). Your name:", "Local trainer")?.trim();
  if (!name) return;
  const principal = { identityProvider: "local", userId: devUserId(name), userDetails: name, userRoles: ["anonymous", "authenticated", "trainer", "admin"] };
  try { localStorage.setItem(DEV_KEY, toBase64(JSON.stringify(principal))); } catch { /* without storage, no local sign-in */ }
  window.location.href = home();
}

export function signOut(): void {
  if (HOSTED) {
    window.location.href = `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`;
    return;
  }
  try { localStorage.removeItem(DEV_KEY); } catch { /* nothing kept */ }
  window.location.href = `${window.location.origin}${window.location.pathname}`;
}
