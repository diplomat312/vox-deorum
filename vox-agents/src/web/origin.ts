/**
 * @module web/origin
 *
 * Loopback policy shared by the local dashboard server and its sensitive routes.
 */

/** Reports whether a hostname names one of the local loopback interfaces. */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/** Reports whether an Origin header identifies a canonical loopback browser origin. */
export function isAllowedLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;

  try {
    const originUrl = new URL(origin);
    return origin === originUrl.origin
      && ['http:', 'https:'].includes(originUrl.protocol)
      && isLoopbackHostname(originUrl.hostname);
  } catch {
    return false;
  }
}

/** Reports whether a request may access a sensitive local-dashboard endpoint. */
export function isAllowedDashboardRequest(hostname: string, origin: string | undefined): boolean {
  return isLoopbackHostname(hostname) && isAllowedLoopbackOrigin(origin);
}
