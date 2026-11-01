// The page's side of the worker in public/sw.js.

// On a save the worker answered from the device, when the network could not.
export const CACHED_HEADER = 'X-Isoca-Cached';

// After the page has loaded, so storing the app does not compete with starting it. This
// page only loads with a session or from the cache, so nothing registers before a login.
export function registerWorker(): void {
  if (!navigator.serviceWorker) return;
  window.addEventListener('load', () => {
    // No worker only means no offline play, and offline this just fails to update.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Worker first, so it cannot store anything after its caches are gone. Each step carries
// on past a failure: the session has already ended, and the rest should still go.
export async function clearDevice(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  } catch {
    // Carry on to the caches.
  }
  if (typeof caches === 'undefined') return;
  try {
    await Promise.allSettled((await caches.keys()).map((name) => caches.delete(name)));
  } catch {
    // Nothing more this page can do; the server's Clear-Site-Data asks the same.
  }
}
