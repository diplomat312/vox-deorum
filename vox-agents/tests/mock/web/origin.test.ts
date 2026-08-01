/** Tests for the loopback policy shared by the dashboard server and sensitive routes. */

import { describe, expect, it } from 'vitest';
import {
  isAllowedDashboardRequest,
  isAllowedLoopbackOrigin,
  isLoopbackHostname,
} from '../../../src/web/origin.js';

describe('loopback origin policy', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['::1', true],
    ['[::1]', true],
    ['dashboard.test', false],
  ])('should recognize %s as a loopback hostname only when appropriate', (hostname, expected) => {
    expect(isLoopbackHostname(hostname)).toBe(expected);
  });

  it.each([
    [undefined, true],
    ['http://localhost:5173', true],
    ['https://127.0.0.1:3000', true],
    ['http://[::1]:4173', true],
    ['https://attacker.test', false],
    ['not an origin', false],
    ['http://localhost:5173/path', false],
  ])('should allow only canonical loopback browser origins', (origin, expected) => {
    expect(isAllowedLoopbackOrigin(origin)).toBe(expected);
  });

  it('should require a loopback request hostname even when Origin is absent', () => {
    expect(isAllowedDashboardRequest('127.0.0.1', undefined)).toBe(true);
    expect(isAllowedDashboardRequest('dashboard.test', undefined)).toBe(false);
  });

  it('should allow a loopback dashboard origin on another port', () => {
    expect(isAllowedDashboardRequest('127.0.0.1', 'http://localhost:5173')).toBe(true);
  });
});
