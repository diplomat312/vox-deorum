// The verbs an OpenCode actor may use in the social environment.
//
// These are the environment's own social operations, served to a model session as
// MCP tools. The shapes are declared here rather than derived from the runtime's
// Zod schemas because a reference is a plain string on the wire: a session server
// is started once and serves many turns, and the set of references an actor may
// name changes between them. The runtime resolves and validates every reference
// after the turn, which is where that check already lived.

/** One tool as a model session sees it. */
export interface OpenCodeSocialToolSpec {
  /** The tool name, which is also the decision tool name the runtime decodes. */
  name: string;
  /** What the verb is for, in the words the model reads. */
  description: string;
  /** The arguments, as JSON Schema, because the session server speaks JSON Schema. */
  inputSchema: Record<string, unknown>;
}

// A reference the model writes as a plain string, resolved by the runtime after
// the turn rather than constrained to an enum the session cannot refresh.
function plain(description: string): Record<string, unknown> {
  return { type: "string", description };
}

/** Every verb, in the order a model should consider them. */
export const openCodeSocialTools: OpenCodeSocialToolSpec[] = [
  {
    name: "social_reply",
    description: "Speak in the room this turn concerns, to answer what was said to you there.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What you say, in your own voice." },
        replyToMessageId: { type: "integer", description: "The message you are answering, when you are answering one." },
      },
      required: ["text"],
    },
  },
  {
    name: "social_send_dm",
    description: "Write privately to one other civilization. Only that one reads it, so it is the only way to say something you do not want overheard.",
    inputSchema: {
      type: "object",
      properties: {
        participantRef: plain("Who you are writing to, by their reference."),
        text: { type: "string", description: "What you say." },
      },
      required: ["participantRef", "text"],
    },
  },
  {
    name: "social_start_group",
    description: "Open a private room for a few civilizations, which is how a smaller group agrees something before it is said in the open.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the room is called." },
        participantRefs: { type: "array", items: { type: "string" }, description: "Who to invite." },
        text: { type: "string", description: "An opening message, when you want one." },
      },
      required: ["title", "participantRefs"],
    },
  },
  {
    name: "social_send_room_message",
    description: "Speak in a private room you belong to.",
    inputSchema: {
      type: "object",
      properties: {
        roomRef: plain("The room, by its reference."),
        text: { type: "string", description: "What you say." },
      },
      required: ["roomRef", "text"],
    },
  },
  {
    name: "social_invite",
    description: "Invite one civilization into a room you belong to.",
    inputSchema: {
      type: "object",
      properties: {
        roomRef: plain("The room, by its reference."),
        participantRef: plain("Who to invite."),
      },
      required: ["roomRef", "participantRef"],
    },
  },
  {
    name: "social_respond_invitation",
    description: "Accept or refuse an invitation to a room.",
    inputSchema: {
      type: "object",
      properties: { accept: { type: "boolean", description: "True to join, false to refuse." } },
      required: ["accept"],
    },
  },
  {
    name: "social_leave_group",
    description: "Leave a room you belong to.",
    inputSchema: {
      type: "object",
      properties: { roomRef: plain("The room, by its reference.") },
      required: ["roomRef"],
    },
  },
  {
    name: "social_pass",
    description: "Say and do nothing this turn. Saying nothing is a decision like any other, and it leaves the others to draw their own conclusions.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string", description: "Why you stayed silent, for the record." } },
    },
  },
];

/** The verb names, which is what a caller filters a turn's tool calls against. */
export const openCodeSocialToolNames: string[] = openCodeSocialTools.map((tool) => tool.name);

