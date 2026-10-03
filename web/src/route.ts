/** Hash routing without a router dependency: #/shelf, #/check, … */
import { useSyncExternalStore } from 'react';

export const ROUTES = ['shelf', 'check', 'plan', 'scan', 'experiments', 'privacy'] as const;
export type Route = (typeof ROUTES)[number];

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'shelf';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    subscribe,
    () => parseRoute(window.location.hash),
    () => 'shelf',
  );
}

export function href(route: Route): string {
  return `#/${route}`;
}

export function navigate(route: Route): void {
  if (parseRoute(window.location.hash) === route) return;
  window.location.hash = `/${route}`;
}
