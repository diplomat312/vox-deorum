// The shapes of one exchange with a seat's model session.
// These are the fields the trace store keeps, so they are named for what they
// mean to the harness rather than for the transport that carried them.

// Token and spend numbers attached to one model response.
export interface SessionUsage {
  // Tokens sent to the model.
  input: number;
  // Tokens the model produced as visible text.
  output: number;
  // Tokens the model spent thinking, when the provider reports them.
  reasoning: number;
  // Tokens served from the provider prompt cache.
  cacheRead: number;
  // Tokens written into the provider prompt cache.
  cacheWrite: number;
  // The provider's own total, or the sum of the parts when it reports none.
  total: number;
  // Spend for this response in provider currency, when reported.
  cost: number | null;
}

// One tool call the seat made during a turn.
export interface SessionToolCall {
  // The tool name as the model called it.
  tool: string;
  // The provider's identifier for the call, used to pair it with its result.
  callID: string | null;
  // The recorded status, for example "completed".
  status: string | null;
  // The arguments the model passed.
  input: unknown;
  // What the tool returned, rendered as text.
  output: string | null;
  // The failure text when the call failed.
  error: string | null;
}

// Everything one seat produced in response to one observation.
export interface SeatTurnResult {
  // The session that answered, so a run can prove persistence.
  session: string;
  // The model the response came from.
  model: string;
  // The model's thinking, when the provider emitted it. This is the raw
  // material for the inspection platform, so it is kept as one string.
  reasoning: string | null;
  // The model's final visible text, when it produced any.
  modelText: string | null;
  // Every tool call the model made, in the order it made them.
  toolCalls: SessionToolCall[];
  // Token and spend numbers for the response.
  usage: SessionUsage;
  // How long the response took, in milliseconds.
  latencyMs: number;
  // Part types we did not recognise, kept so nothing silently disappears.
  unknownParts: string[];
}

// The subset of a harness model setting a seat needs: which provider serves it,
// and which model to ask for.
export interface SeatModel {
  // The provider identifier, for example "opencode-go".
  providerID: string;
  // The model identifier, for example "deepseek-v4.1-flash".
  modelID: string;
}
