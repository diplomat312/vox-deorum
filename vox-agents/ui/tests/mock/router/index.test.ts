import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSetupStatus } = vi.hoisted(() => ({ checkSetupStatus: vi.fn() }));

vi.mock('@/api/client', () => ({ api: { checkSetupStatus } }));

import router from '@/router';

/** Run the root route guard with the minimal arguments it ignores. */
async function runRootGuard(): Promise<unknown> {
  const guard = router.resolve('/').matched[0]?.beforeEnter;
  if (!guard || Array.isArray(guard)) throw new Error('The root route guard is unavailable.');
  return guard.call(undefined, {} as never, {} as never, vi.fn());
}

describe('first-run routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens guided setup when configuration is incomplete', async () => {
    checkSetupStatus.mockResolvedValue({ configured: false });
    await expect(runRootGuard()).resolves.toBe('/config?setup=1');
  });

  it('opens session control when configuration is complete', async () => {
    checkSetupStatus.mockResolvedValue({ configured: true });
    await expect(runRootGuard()).resolves.toBe('/session');
  });

  it('preserves the session fallback when the check fails', async () => {
    checkSetupStatus.mockRejectedValue(new Error('offline'));
    await expect(runRootGuard()).resolves.toBe('/session');
  });
});
