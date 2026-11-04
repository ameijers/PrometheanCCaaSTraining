// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Loaded first in every Toolbox tool page the training opens in an iframe. It gives the tool the
// simulator's Xrm and a fetch that answers the simulated address, both from the shell (the parent
// page). The tool's own code runs unchanged after this.

interface Host { xrm: unknown; fetch: typeof fetch }

const host: Host | undefined = (() => {
  try { return (window.parent as any).__ccaasTraining; } catch { return undefined; }
})();

if (host) {
  (window as any).Xrm = host.xrm;
  const own = window.fetch.bind(window);
  // Requests to the simulated address go to the shell's simulator; everything else is the page's own fetch.
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(host.xrm && (host.xrm as any).Utility.getGlobalContext().getClientUrl()) ? host.fetch(input, init) : own(input, init);
  }) as typeof fetch;
  // Links to a record of the simulated environment (the Diagram's "Open record") would open a browser tab
  // to an address that doesn't exist. They go to the training instead, through Xrm.Navigation.openUrl.
  const clientUrl = (host.xrm as any).Utility.getGlobalContext().getClientUrl() as string;
  document.addEventListener("click", (e) => {
    const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || !link.href.startsWith(clientUrl)) return;
    e.preventDefault();
    (host.xrm as any).Navigation.openUrl(link.href);
  }, true);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML("afterbegin", '<p style="font:14px sans-serif;padding:8px 16px;background:#fde7e9;margin:0">Open this tool from the training, so it runs against the simulated environment.</p>');
  });
}
