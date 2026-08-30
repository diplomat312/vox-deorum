import { describe, expect, it } from 'vitest';
import { SocialEventProjector } from '../../../src/social/events/social-event-projector.js';

describe('SocialEventProjector', () => {
  it('suppresses hidden channel events and redacts message bodies', async () => {
    const projector = new SocialEventProjector(async (channelId) => channelId === 'world');
    await expect(projector.project({ type: 'intention-created', intention: {} as never })).resolves.toBeUndefined();
    await expect(projector.project({ type: 'membership-changed', membership: { channelId: 'secret' } as never })).resolves.toBeUndefined();
    await expect(projector.project({ type: 'message-added', message: { id: 3, channelId: 'world', content: 'private body' } as never })).resolves.toMatchObject({ type: 'message-added', message: { id: 3, channelId: 'world', content: '' } });
  });
});
