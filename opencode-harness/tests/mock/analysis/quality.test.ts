// Covers the message quality reading.
//
// The messages used here are real ones the seats sent in simulated games, so a
// rule that reads them wrongly fails a test rather than passing quietly.

import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  isSubstantive,
  namesAnotherSeat,
  partyNamesFor,
  qualityMetrics
} from "../../../src/analysis/quality.js";

// The four seats, so a test can ask whether a message named one of them.
const seats = ["korea", "austria", "siam", "iroquois"];

describe("reading what a message does", () => {
  it("should read a courtesy greeting as ceremony", () => {
    const message = classifyMessage(
      "austria",
      "world",
      "Greetings, fellow rulers. Austria opens its hand in friendship to all. May our peoples prosper."
    );

    expect(message.moves).toEqual(["ceremony"]);
    expect(isSubstantive(message)).toBe(false);
  });

  it("should read a pledge as a commitment", () => {
    const message = classifyMessage(
      "iroquois",
      "world",
      "The Iroquois raise warriors only to defend their own soil. Hiawatha claims no neighbor's land."
    );

    expect(message.moves).toContain("commitment");
    expect(isSubstantive(message)).toBe(true);
  });

  it("should read a suggestion of an arrangement as a proposal", () => {
    const message = classifyMessage(
      "korea",
      "dm:korea:siam",
      "Let us trade fairly when each of us holds what the other values, and ask nothing as a gift."
    );

    expect(message.moves).toContain("proposal");
  });

  it("should read an apology with restitution as repair", () => {
    const message = classifyMessage(
      "austria",
      "dm:austria:korea",
      "Sejong, you are owed better than you got from me. Take this as a first step toward rebuilding what I cost us."
    );

    expect(message.moves).toContain("apology");
  });

  it("should read a named grievance as an accusation", () => {
    const message = classifyMessage("korea", "world", "Austria broke your word to us and the terms were never honoured.");

    expect(message.moves).toContain("accusation");
  });

  it("should read a warning about a build-up as a demand", () => {
    const message = classifyMessage(
      "siam",
      "dm:iroquois:siam",
      "A friend's counsel, freely given: your recent levy has been noticed, and quieter courts grow uneasy. A calm word from you would steady many minds."
    );

    expect(message.moves).toContain("demand");
    expect(message.moves).toContain("information");
  });

  it("should read a question as a question", () => {
    const message = classifyMessage("siam", "world", "Shall we speak again as our borders grow?");

    expect(message.moves).toContain("question");
  });

  it("should catch a message that leaked the machinery", () => {
    // A seat that reasons about the simulation rather than the world is a cost
    // worth measuring, because it means the fiction did not hold.
    const message = classifyMessage("korea", "world", "This looks like a scripted crisis the sim injected to test us.");

    expect(message.moves).toContain("meta");
  });

  it("should treat a message that matched nothing as courtesy rather than as nothing", () => {
    const message = classifyMessage("siam", "world", "Sukhothai stands.");

    expect(message.moves).toEqual(["ceremony"]);
  });

  it("should notice when a message names another seat", () => {
    const named = classifyMessage("korea", "world", "Sejong thanks Ramkhamhaeng for carrying that word.");
    const general = classifyMessage("korea", "world", "We thank every court that keeps faith.");
    const parties = partyNamesFor(seats);

    // A seat writes its neighbor's leader name or civilization, never the
    // harness's seat id, so the names looked for include both.
    expect(namesAnotherSeat(named, parties, ["Korea", "Sejong"])).toBe(true);
    expect(namesAnotherSeat(general, parties, ["Korea", "Sejong"])).toBe(false);
  });

  it("should not count a seat naming itself as addressing someone else", () => {
    const message = classifyMessage("siam", "world", "Siam keeps only what defends its people.");

    expect(namesAnotherSeat(message, partyNamesFor(seats), ["Siam", "Ramkhamhaeng"])).toBe(false);
  });
});

describe("reading a run's messages together", () => {
  it("should count the moves, the substance and the leaks", () => {
    const entries = [
      { from: "austria", to: "world", kind: "world", text: "Greetings to all peoples. May we prosper in peace." },
      {
        from: "siam",
        to: "world",
        kind: "world",
        text: "I have seen a doubled host on the frontier, and Siam will not match it. We pledge no sword beyond our own defense."
      },
      { from: "korea", to: "dm:korea:siam", kind: "dm", text: "Ramkhamhaeng, let us trade fairly and ask nothing as a gift." },
      { from: "iroquois", to: "world", kind: "world", text: "The system says we broke our word, but the sim did not record a deal." }
    ];

    const metrics = qualityMetrics(entries, seats);

    expect(metrics.messages).toBe(4);
    expect(metrics.byMove.ceremony).toBe(1);
    expect(metrics.substantive).toBe(3);
    expect(metrics.substantiveRate).toBeCloseTo(0.75, 6);
    expect(metrics.proposals).toBe(1);
    expect(metrics.meta).toBe(1);
    expect(metrics.metaRate).toBeCloseTo(0.25, 6);
    // One message addresses another party by name: the Korean offer to Siam's
    // leader. The Siam message names Siam, which is the author, so it does not
    // count, and the leak names nobody.
    expect(metrics.personalised).toBe(1);
    expect(metrics.personalisedRate).toBeCloseTo(0.25, 6);
  });

  it("should report nothing rather than failing on a silent table", () => {
    const metrics = qualityMetrics([], seats);

    expect(metrics.messages).toBe(0);
    expect(metrics.substantiveRate).toBe(0);
    expect(metrics.metaRate).toBe(0);
    expect(metrics.labelled).toEqual([]);
  });

  it("should label every message so a label can be checked against its text", () => {
    const metrics = qualityMetrics(
      [{ from: "korea", to: "world", kind: "world", text: "Korea greets the assembled rulers." }],
      seats
    );

    expect(metrics.labelled).toHaveLength(1);
    expect(metrics.labelled[0].from).toBe("korea");
    expect(metrics.labelled[0].text).toContain("assembled rulers");
  });
});
