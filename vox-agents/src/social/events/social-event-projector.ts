import type { SocialEvent } from './social-event-hub.js';

/** Projects committed events to one viewer without exposing hidden rooms or message bodies. */
export class SocialEventProjector {
  public constructor(private readonly canSeeChannel: (channelId: string) => Promise<boolean>, private readonly inspect = false, private readonly canSeeOwnInvitation: (actorId: string) => boolean = () => false) {}

  public async project(event: SocialEvent): Promise<SocialEvent | undefined> {
    if (event.type === 'intention-created') return undefined;
    const channelId = event.type === 'channel-created' ? event.channel.id : event.type === 'message-added' ? event.message.channelId : event.membership.channelId;
    if (!this.inspect && !(await this.canSeeChannel(channelId)) && !(event.type === 'membership-changed' && event.membership.status === 'invited' && this.canSeeOwnInvitation(event.membership.actorId))) return undefined;
    if (event.type === 'message-added') return { type: event.type, message: { id: event.message.id, channelId: event.message.channelId, speakerActorId: event.message.speakerActorId, content: '', replyToMessageId: null, createdAt: event.message.createdAt, intentionId: null, idempotencyKey: null } };
    return event;
  }
}
