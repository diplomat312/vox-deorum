// Vox Deorum harness: turn the recorded fresh4 seats into a calibration file a simulator can read.
//
// The simulator has to advance at the rates the real game produced, so every value in the output
// is read straight out of the recorded observation text. Nothing is guessed: when a turn's text
// does not carry a field, that field simply does not appear in that turn's object.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(scriptDir, "..", "corpus", "fresh4");
const outputPath = join(scriptDir, "..", "corpus", "fresh4-calibration.json");
const corpusLabel = "opencode-harness/corpus/fresh4";
const outputLabel = "opencode-harness/corpus/fresh4-calibration.json";
const gameName = "fresh4";

// The observation text has a stable shape, so each field is pulled with one pattern. A few
// fields read "undefined" in the game's own text, and those patterns simply fail to match,
// which leaves the field out of that turn.
const turnPattern = /^TURN (\d+)/;
const identityPattern = /You are ([^,\n]+), leader of ([^(\n]+) \(seat (\d+)\)/;
const treasuryPattern = /Treasury: (-?[\d.]+) \(\+(-?[\d.]+|undefined)\/turn\)\./;
const researchPattern = /Research: (.+?) \(Estimated in (-?[\d.]+) turns\)\./;
const policyPattern = /Next policy in ([\d.]+) turns/;
const citiesPattern =
  /^\* Cities \((\d+)\): population (\d+), territory (\d+), military strength (\d+), units (\d+) \(supply (\d+)\), score (\d+)\.$/;
const rivalPattern =
  /^\* (.+?) visible: era (.+?), score (\d+), treasury ~(\d+), research (.+?), (\d+) cities, military (\d+)\.$/;
const rivalResearchPattern = /^(.+?) \(Estimated in (-?[\d.]+) turns\)$/;

/** Converts a captured token to a number, keeping whole numbers exact and trimming float noise. */
function toNumber(token) {
  const value = Number(token);
  if (!Number.isFinite(value)) return undefined;
  if (value === 0) return 0;
  return Number.isInteger(value) ? value : roundTo(value, 4);
}

/** Rounds to a fixed number of decimals so two runs always print identical bytes. */
function roundTo(value, decimals) {
  return Number(value.toFixed(decimals));
}

/** Returns the median of a numeric list, or undefined when the list is empty. */
function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number.isInteger(value) ? value : roundTo(value, 4);
}

/** Sorts every object key recursively, which makes the written JSON deterministic. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/** Splits an observation into trimmed lines so each field can be matched on its own line. */
function toLines(text) {
  return text.split("\n").map((line) => line.trim());
}

/** Reads the seat identity from the opening line, falling back to the record's own fields. */
function parseIdentity(text, record) {
  const match = text.match(identityPattern);
  if (match) {
    return { leader: match[1].trim(), civ: match[2].trim(), playerID: Number(match[3]) };
  }
  return { leader: undefined, civ: record.seat, playerID: record.playerID };
}

/** Reads the current block: treasury, gold per turn, research progress and the policy countdown. */
function parseCurrent(text) {
  const current = {};
  const treasury = text.match(treasuryPattern);
  if (treasury) {
    current.treasury = toNumber(treasury[1]);
    if (treasury[2] !== "undefined") current.goldPerTurn = toNumber(treasury[2]);
  }
  const research = text.match(researchPattern);
  if (research) {
    current.research = research[1].trim();
    current.researchTurnsLeft = toNumber(research[2]);
  }
  const policy = text.match(policyPattern);
  if (policy) current.policyTurnsLeft = toNumber(policy[1]);
  return current;
}

/** Reads the empire totals line: cities, population, territory, military, units, supply and score. */
function parseCities(text) {
  const line = toLines(text).find((candidate) => candidate.startsWith("* Cities ("));
  const match = line ? line.match(citiesPattern) : null;
  if (!match) return {};
  return {
    cities: toNumber(match[1]),
    population: toNumber(match[2]),
    territory: toNumber(match[3]),
    militaryStrength: toNumber(match[4]),
    units: toNumber(match[5]),
    militarySupply: toNumber(match[6]),
    score: toNumber(match[7]),
  };
}

/** Reads the rival visible line, which is the only place another civ's era or treasury shows up. */
function parseRival(text) {
  const line = toLines(text).find((candidate) => candidate.includes(" visible: "));
  const match = line ? line.match(rivalPattern) : null;
  if (!match) return undefined;
  const rival = {
    name: match[1].trim(),
    era: match[2].trim(),
    score: toNumber(match[3]),
    treasury: toNumber(match[4]),
    cities: toNumber(match[6]),
    military: toNumber(match[7]),
  };
  const research = match[5].trim();
  if (research !== "undefined") {
    const estimate = research.match(rivalResearchPattern);
    if (estimate) {
      rival.research = estimate[1].trim();
      rival.researchTurnsLeft = toNumber(estimate[2]);
    } else {
      rival.research = research;
    }
  }
  return rival;
}

/** Builds one series entry from a record, dropping every field the turn's text does not carry. */
function buildSeriesEntry(record) {
  const text = record.observation;
  const turn = text.match(turnPattern);
  const entry = turn ? { turn: toNumber(turn[1]) } : {};
  return Object.assign(entry, parseCurrent(text), parseCities(text));
}

/** Turns a rival observation into the entry shape the observed block stores. */
function buildRivalEntry(turn, rival) {
  const entry = { turn: turn };
  if (rival.era !== undefined) entry.era = rival.era;
  if (rival.score !== undefined) entry.score = rival.score;
  if (rival.treasury !== undefined) entry.treasury = rival.treasury;
  if (rival.research !== undefined) entry.research = rival.research;
  if (rival.researchTurnsLeft !== undefined) entry.researchTurnsLeft = rival.researchTurnsLeft;
  if (rival.cities !== undefined) entry.cities = rival.cities;
  if (rival.military !== undefined) entry.military = rival.military;
  return entry;
}

/** Returns the first defined value of a key across a series, searching forwards or backwards. */
function edgeValue(series, key, fromEnd) {
  const ordered = fromEnd ? [...series].reverse() : series;
  const hit = ordered.find((entry) => entry[key] !== undefined);
  return hit ? hit[key] : undefined;
}

/** Returns the median change per turn for a key across consecutive readable turns. */
function perTurnMedian(series, key) {
  const rates = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const gap = current.turn - previous.turn;
    if (gap <= 0) continue;
    if (previous[key] === undefined || current[key] === undefined) continue;
    rates.push((current[key] - previous[key]) / gap);
  }
  return median(rates);
}

/** Computes the per seat summary from the series that actually came out of the text. */
function buildSummary(series, citySteps) {
  const perTurn = {};
  const gold = series.map((entry) => entry.goldPerTurn).filter((value) => value !== undefined);
  const goldPerTurnMedian = median(gold);
  if (goldPerTurnMedian !== undefined) perTurn.goldPerTurnMedian = goldPerTurnMedian;
  const goldPerTurnAtStart = edgeValue(series, "goldPerTurn", false);
  if (goldPerTurnAtStart !== undefined) perTurn.goldPerTurnAtStart = goldPerTurnAtStart;
  const goldPerTurnAtEnd = edgeValue(series, "goldPerTurn", true);
  if (goldPerTurnAtEnd !== undefined) perTurn.goldPerTurnAtEnd = goldPerTurnAtEnd;
  const scorePerTurnMedian = perTurnMedian(series, "score");
  if (scorePerTurnMedian !== undefined) perTurn.scorePerTurnMedian = scorePerTurnMedian;
  const populationPerTurnMedian = perTurnMedian(series, "population");
  if (populationPerTurnMedian !== undefined) {
    perTurn.populationPerTurnMedian = populationPerTurnMedian;
  }
  const firstCities = edgeValue(series, "cities", false);
  const lastCities = edgeValue(series, "cities", true);
  if (firstCities !== undefined && lastCities !== undefined) {
    perTurn.citiesAdded = lastCities - firstCities;
  }

  // The seat's own era never appears in its own observation, so the series carries no era and
  // there is no eraSequence to emit. The rival visible line is the only place era is written.
  const summary = {
    firstTurn: series[0].turn,
    lastTurn: series[series.length - 1].turn,
    turnsWithData: series.length,
    startState: series[0],
    endState: series[series.length - 1],
    perTurn: perTurn,
  };
  const firstCity = citySteps.find((step) => step.cities >= 1);
  const secondCity = citySteps.find((step) => step.cities >= 2);
  if (firstCity) summary.firstCityTurn = firstCity.turn;
  if (firstCity && secondCity && secondCity.turn >= firstCity.turn) {
    summary.turnsToSecondCity = secondCity.turn - firstCity.turn;
  }
  return summary;
}

/** Reads every seat file in the corpus, sorted by name so runs stay byte identical. */
function readSeats() {
  const files = readdirSync(corpusDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  return files.map((name) => {
    const records = readFileSync(join(corpusDir, name), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    return { seat: name.replace(/\.jsonl$/, ""), records: records };
  });
}

/** Counts tool calls across every seat, by tool name and, for inspect, by subject argument. */
function buildToolUsage(seats) {
  const toolCallCounts = {};
  const inspectSubjects = {};
  const perTurnCounts = [];
  let turnsWithNoToolCall = 0;
  for (const seat of seats) {
    for (const record of seat.records) {
      const calls = record.toolCalls || [];
      perTurnCounts.push(calls.length);
      if (calls.length === 0) turnsWithNoToolCall += 1;
      for (const call of calls) {
        toolCallCounts[call.tool] = (toolCallCounts[call.tool] || 0) + 1;
        if (call.tool.endsWith("_inspect")) {
          const subject = call.input ? String(call.input.subject) : "undefined";
          inspectSubjects[subject] = (inspectSubjects[subject] || 0) + 1;
        }
      }
    }
  }
  const toolUsage = {
    toolCallCounts: toolCallCounts,
    inspectSubjects: inspectSubjects,
    turnsWithNoToolCall: turnsWithNoToolCall,
  };
  const toolCallsPerTurnMedian = median(perTurnCounts);
  if (toolCallsPerTurnMedian !== undefined) {
    toolUsage.toolCallsPerTurnMedian = toolCallsPerTurnMedian;
  }
  return toolUsage;
}

/** Gathers the timing block straight from the extracted series. */
function buildTiming(seatResults) {
  const gaps = [];
  const researchEstimates = [];
  const policyEstimates = [];
  const firstCityTurns = [];
  const secondCitySteps = [];
  for (const result of seatResults) {
    for (let index = 1; index < result.series.length; index += 1) {
      gaps.push(result.series[index].turn - result.series[index - 1].turn);
    }
    for (const entry of result.series) {
      if (entry.researchTurnsLeft !== undefined) researchEstimates.push(entry.researchTurnsLeft);
      if (entry.policyTurnsLeft !== undefined) policyEstimates.push(entry.policyTurnsLeft);
    }
    if (result.summary.firstCityTurn !== undefined) firstCityTurns.push(result.summary.firstCityTurn);
    if (result.summary.turnsToSecondCity !== undefined) {
      secondCitySteps.push(result.summary.turnsToSecondCity);
    }
  }
  const timing = {};
  const medianTurnGap = median(gaps);
  if (medianTurnGap !== undefined) timing.medianTurnGap = medianTurnGap;
  const researchTurnsMedian = median(researchEstimates);
  if (researchTurnsMedian !== undefined) timing.researchTurnsMedian = researchTurnsMedian;
  const policyTurnsMedian = median(policyEstimates);
  if (policyTurnsMedian !== undefined) timing.policyTurnsMedian = policyTurnsMedian;
  if (firstCityTurns.length > 0) timing.firstCityTurn = Math.min.apply(null, firstCityTurns);
  const medianTurnsToSecondCity = median(secondCitySteps);
  if (medianTurnsToSecondCity !== undefined) {
    timing.medianTurnsToSecondCity = medianTurnsToSecondCity;
  }
  return timing;
}

/** Records the real caveats found in the corpus, derived from the data rather than assumed. */
function buildNotes(seatResults) {
  const notes = [];
  const observedCivs = new Set();
  for (const result of seatResults) {
    for (const name of Object.keys(result.rivals)) observedCivs.add(name);
  }
  const unobserved = seatResults
    .map((result) => result.civ)
    .filter((civ) => !observedCivs.has(civ));
  const observedPairs = seatResults
    .map(
      (result) =>
        result.seat + " sees " + (Object.keys(result.rivals).join(" and ") || "nobody")
    )
    .join(", ");
  notes.push("Only one rival is visible per turn, so the observed block is thin: " + observedPairs + ".");
  if (unobserved.length > 0) {
    notes.push(
      "No seat ever observes " +
        unobserved.sort().join(", ") +
        ", so those civs never appear in a rivals block and their era is never recorded."
    );
  }
  const anyEra = seatResults.some((result) =>
    result.series.some((entry) => entry.era !== undefined)
  );
  if (!anyEra) {
    notes.push(
      "No seat observation carries that seat's own era (era appears only in the rival visible line), so series entries have no era field and no eraSequence is emitted."
    );
  }

  const counts = seatResults.map((result) => result.series.length);
  const largest = Math.max.apply(null, counts);
  for (const result of seatResults) {
    if (result.series.length * 2 < largest) {
      notes.push(
        result.seat +
          " is sparse: " +
          result.series.length +
          " readable turns across turns " +
          result.summary.firstTurn +
          " to " +
          result.summary.lastTurn +
          ", so its per-turn rates and second-city timing are coarse."
      );
    }
  }

  const missing = { goldPerTurn: 0, research: 0, policyTurnsLeft: 0 };
  let negativeGold = 0;
  let negativeEstimates = 0;
  let rivalResearchMissing = 0;
  let cityDrops = 0;
  for (const result of seatResults) {
    let previousCities;
    for (const entry of result.series) {
      if (entry.goldPerTurn === undefined) missing.goldPerTurn += 1;
      else if (entry.goldPerTurn < 0) negativeGold += 1;
      if (entry.research === undefined) missing.research += 1;
      if (entry.policyTurnsLeft === undefined) missing.policyTurnsLeft += 1;
      if (entry.researchTurnsLeft !== undefined && entry.researchTurnsLeft < 0) {
        negativeEstimates += 1;
      }
      if (entry.policyTurnsLeft !== undefined && entry.policyTurnsLeft < 0) {
        negativeEstimates += 1;
      }
      if (entry.cities !== undefined) {
        if (previousCities !== undefined && entry.cities < previousCities) cityDrops += 1;
        previousCities = entry.cities;
      }
    }
    for (const turns of Object.values(result.rivals)) {
      for (const entry of turns) {
        if (entry.research === undefined) rivalResearchMissing += 1;
        if (entry.researchTurnsLeft !== undefined && entry.researchTurnsLeft < 0) {
          negativeEstimates += 1;
        }
      }
    }
  }
  const missingParts = [];
  const plural = (count, noun) => count + " " + noun + (count === 1 ? "" : "s");
  if (missing.goldPerTurn > 0) {
    missingParts.push(plural(missing.goldPerTurn, "turn") + " of gold per turn");
  }
  if (missing.research > 0) {
    missingParts.push(plural(missing.research, "turn") + " of research");
  }
  if (missing.policyTurnsLeft > 0) {
    missingParts.push(plural(missing.policyTurnsLeft, "turn") + " of the policy countdown");
  }
  if (missingParts.length > 0) {
    notes.push(
      'The text reads "undefined" for ' +
        missingParts.join(", ") +
        ", and those fields are omitted rather than guessed."
    );
  }
  if (negativeGold > 0) {
    notes.push(
      "Gold per turn is negative in " +
        negativeGold +
        ' turns, which the text writes as "+-N/turn".'
    );
  }
  if (negativeEstimates > 0) {
    notes.push(
      "A countdown can read negative (" +
        plural(negativeEstimates, "entry") +
        " does), which is the engine rounding an almost finished item."
    );
  }
  if (rivalResearchMissing > 0) {
    notes.push(
      'Rival research reads "undefined" in ' +
        rivalResearchMissing +
        " observed turns, which drops the research fields on those rival entries."
    );
  }
  if (cityDrops > 0) {
    notes.push(
      "City counts fall as well as rise (" +
        cityDrops +
        " drops), so citiesAdded is a net change and not a count of foundings."
    );
  }
  const flatGrowth = seatResults
    .filter((result) => result.summary.perTurn.populationPerTurnMedian === 0)
    .map((result) => result.seat);
  if (flatGrowth.length > 0) {
    notes.push(
      "Population per turn comes out as 0 for " +
        flatGrowth.join(", ") +
        ", and that is the median of a lumpy series: population moves in single steps on a few turns and stands still on the rest, so a simulator should read the published population spread rather than the median alone."
    );
  }
  const startTurns = [...new Set(seatResults.map((result) => result.summary.firstTurn))].sort(
    (a, b) => a - b
  );
  if (startTurns.length > 1) {
    notes.push(
      "Seat records do not share a start turn (first turns " +
        startTurns.join(", ") +
        "), because turn 0 is the opening state for most seats while the Korea record opens at turn 1."
    );
  }
  notes.push(
    "Research and policy counts are the engine's own projections, so they drift as science and culture change and are not fixed durations."
  );
  return notes;
}

/** Reads the corpus, extracts every seat, and writes the calibration file. */
function main() {
  const seats = readSeats();
  const seatResults = seats.map((seat) => {
    const series = seat.records.map(buildSeriesEntry).sort((a, b) => a.turn - b.turn);
    const citySteps = series
      .filter((entry) => entry.cities !== undefined)
      .map((entry) => ({ turn: entry.turn, cities: entry.cities }));
    const rivals = {};
    for (const record of seat.records) {
      const rival = parseRival(record.observation);
      if (!rival) continue;
      const turnMatch = record.observation.match(turnPattern);
      const turn = turnMatch ? toNumber(turnMatch[1]) : undefined;
      if (!rivals[rival.name]) rivals[rival.name] = [];
      rivals[rival.name].push(buildRivalEntry(turn, rival));
    }
    for (const name of Object.keys(rivals)) {
      rivals[name].sort((a, b) => a.turn - b.turn);
    }
    const identity = parseIdentity(seat.records[0].observation, seat.records[0]);
    return {
      seat: seat.seat,
      civ: identity.civ,
      leader: identity.leader,
      playerID: identity.playerID,
      series: series,
      rivals: rivals,
      summary: buildSummary(series, citySteps),
    };
  });

  const seatBlock = {};
  for (const result of [...seatResults].sort((a, b) => a.seat.localeCompare(b.seat))) {
    seatBlock[result.seat] = {
      civ: result.civ,
      leader: result.leader,
      playerID: result.playerID,
      series: result.series,
      observed: { rivals: result.rivals },
      summary: result.summary,
    };
  }

  const calibration = {
    game: gameName,
    generatedFrom: corpusLabel,
    seats: seatBlock,
    timing: buildTiming(seatResults),
    toolUsage: buildToolUsage(seats),
    notes: buildNotes(seatResults),
  };

  writeFileSync(outputPath, JSON.stringify(sortKeysDeep(calibration), null, 2) + "\n", "utf8");

  const lines = ["Wrote " + outputLabel];
  for (const result of seatResults) {
    lines.push(
      result.seat +
        ": turns " +
        result.summary.firstTurn +
        ".." +
        result.summary.lastTurn +
        ", " +
        result.summary.turnsWithData +
        " readable"
    );
  }
  const timing = calibration.timing;
  lines.push(
    "timing: medianTurnGap " +
      timing.medianTurnGap +
      ", researchTurnsMedian " +
      timing.researchTurnsMedian +
      ", policyTurnsMedian " +
      timing.policyTurnsMedian +
      ", firstCityTurn " +
      timing.firstCityTurn +
      ", medianTurnsToSecondCity " +
      timing.medianTurnsToSecondCity
  );
  process.stdout.write(lines.join("\n") + "\n");
}

main();
