// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Toolbox code finds Xrm as a global (resolveXrm in tools/shared/src/xrm.ts). Tests put the
// simulator's there, the way the shell puts it on window.
export function installGlobalXrm(xrm: unknown): void {
  (globalThis as any).Xrm = xrm;
}
