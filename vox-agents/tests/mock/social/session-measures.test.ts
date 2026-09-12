// Covers the readings that reduce a session to numbers.
//
// These are heuristics over wording, so the tests use sentences the models
// actually wrote in the first generated world. A reader that fires on the wrong
// line is worse than no reader, and the sentences below are the ones that could
// plausibly be misread.

import { describe, expect, it } from "vitest";
import { measureSession, readMessage, renderMeasures } from "../../../src/social/environments/simulated/session-measures.js";
import type { SocialMessage } from "../../../src/social/types.js";

// One message, as the store holds it.
function message(id: number, speakerActorId: string, content: string, channelId = "world"): SocialMessage {
  return {
    id,
    channelId,
    speakerActorId,
    content,
    replyToMessageId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    intentionId: null,
    idempotencyKey: null
  };
}

describe("reading one message", () => {
  it("should read a question about intent as a probe", () => {
    // Verbatim from the run: Austria asking Siam what a massing is for.
    const read = readMessage(
      message(
        7,
        "austria",
        "I ask you plainly, before all these crowns: what is the purpose of that gathering? If it is a misunderstanding, tell me and we will settle it.",
        "world"
      ),
      "world"
    );

    expect(read.asks).toBe(true);
    expect(read.probesIntent).toBe(true);
    expect(read.moves).toContain("intel");
  });

  it("should not read a plain offer as a probe", () => {
    // A proposal that asks nothing has no question mark, and an offer is not an
    // interrogation however warm it is.
    const read = readMessage(
      message(1, "siam", "I propose we keep it that way: no wars, open talk, and honest dealing.", "world"),
      "world"
    );

    expect(read.asks).toBe(false);
    expect(read.probesIntent).toBe(false);
    expect(read.moves).toContain("proposal");
  });

  it("should not read a greeting that mentions a neighbour as a probe", () => {
    // Verbatim: warm, addressed to neighbours, and asking nothing at all.
    const read = readMessage(
      message(2, "austria", "To Korea and Morocco: our borders are quiet and we intend to keep them so.", "world"),
      "world"
    );

    expect(read.asks).toBe(false);
    expect(read.probesIntent).toBe(false);
  });

  it("should read a promise about conduct as a commitment", () => {
    const read = readMessage(
      message(5, "iroquois", "The Iroquois will not strike first, and we will keep whatever word we give.", "world"),
      "world"
    );

    expect(read.moves).toContain("commitment");
  });

  it("should read a named broken word as an accusation", () => {
    // Verbatim: Korea naming a second massing after a promise not to.
    const read = readMessage(
      message(11, "korea", "This is the second time Austria has gathered its host at our border. I will hold Austria solely to blame.", "world"),
      "world"
    );

    expect(read.moves).toContain("accusation");
    expect(read.moves).toContain("warning");
  });

  // The lines below are verbatim from a second benchmark run, and every one of
  // them was missed by the first version of this reader. A reader that under
  // counts is worse than no reader, because the missing number reads as a fact
  // about the table rather than about the pattern.
  it("should read a warning phrased as a consequence", () => {
    const read = readMessage(
      message(8, "austria", "Any attack on my land will be met, and the whole table will know who moved first. If it is territory, the answer is no."),
      "world"
    );

    expect(read.moves).toContain("warning");
  });

  it("should read a demand phrased as an instruction", () => {
    const read = readMessage(
      message(8, "austria", "Withdraw your troops from my frontier and there is nothing between us but quiet."),
      "world"
    );

    expect(read.moves).toContain("demand");
  });

  it("should read an accusation that names a contrast rather than a crime", () => {
    const read = readMessage(
      message(8, "austria", "I see 70% of your army camped on my border, a turn after I offered you peace. I have kept that promise."),
      "world"
    );

    expect(read.moves).toContain("accusation");
  });

  it("should read an intent probe phrased as an instruction", () => {
    // No question mark, and unambiguously a question about what someone intends.
    const read = readMessage(
      message(7, "korea", "Tell me plainly what is afoot, and I will know where Siam stands."),
      "world"
    );

    expect(read.asks).toBe(false);
    expect(read.probesIntent).toBe(true);
  });

  it("should still not read a plain greeting as a probe", () => {
    const read = readMessage(
      message(1, "austria", "Greetings, fellow civilizations. Austria begins in peace and wishes the same for all."),
      "world"
    );

    expect(read.probesIntent).toBe(false);
    expect(read.moves).not.toContain("warning");
  });

  it("should tell a private message from an open one", () => {
    expect(readMessage(message(6, "austria", "A word between neighbours.", "dm-1"), "world").scope).toBe("private");
    expect(readMessage(message(6, "austria", "A word between neighbours.", "world"), "world").scope).toBe("world");
  });
});

describe("reducing a session", () => {
  const seats = ["korea", "austria", "siam", "iroquois", "morocco"];

  it("should count what one run of the world produced", () => {
    const messages = [
      message(1, "siam", "Greetings. I propose we keep the peace.", "world"),
      message(2, "austria", "To the table: what is the purpose of that gathering?", "world"),
      message(3, "korea", "I will not strike first, but I will defend my people.", "world"),
      message(4, "korea", "Maria Theresa, to what end is your host at our border?", "dm-1"),
      message(5, "austria", "Sejong, the movement was a standing deployment. I propose an understanding.", "dm-1")
    ];
    const actions = [
      { actorId: "korea", selectedKind: "send_message", applicationOutcome: "send_message", error: null },
      { actorId: "austria", selectedKind: "environment_action", applicationOutcome: "environment_action:Austria has its army at home", error: null },
      { actorId: "siam", selectedKind: "environment_action", applicationOutcome: null, error: "the world refused" }
    ];

    const measures = measureSession(messages, "world", seats, actions);

    expect(measures.messages).toBe(5);
    expect(measures.worldMessages).toBe(3);
    expect(measures.privateMessages).toBe(2);
    expect(measures.privateChannels).toBe(1);
    expect(measures.intentProbes).toBe(2);
    expect(measures.proposals).toBe(2);
    // Two seats never said anything at all.
    expect(measures.seatsSilent).toBe(2);
    // Austria and Korea both spoke twice, and a tie is broken by name so the
    // reading does not move between runs.
    expect(measures.busiestSeat).toEqual({ seat: "austria", messages: 2 });
    expect(measures.refusals).toBe(1);
    expect(measures.actions["Austria has its army at home"]).toBe(1);
  });

  it("should survive a session where nobody spoke", () => {
    const measures = measureSession([], "world", seats, []);

    // An empty table is a real outcome and should be reportable rather than a
    // crash: silence is the result this bench keeps failing to explain.
    expect(measures.messages).toBe(0);
    expect(measures.seatsSilent).toBe(5);
    expect(measures.busiestSeat).toBeNull();
    expect(renderMeasures(measures, "an empty table")).toContain("Seats that never spoke | 5");
  });
});
