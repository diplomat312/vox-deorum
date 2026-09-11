// The state of a simulated game.
// This is a deliberately small model of Civilization: enough of it that a seat
// faces a situation which moves in believable ways and reacts to what it does,
// and no more. The material world is ours, which is what makes the diplomacy
// causal: what a seat says and does genuinely changes what the others see.

// One city a seat owns.
export interface SimCity {
  // The city name, drawn from the civilization's own list.
  name: string;
  // The city population.
  population: number;
  // Tiles worked, which grows with population.
  tiles: number;
  // What the city is building, or null when nothing is queued.
  production: string | null;
  // How many turns the current build has left.
  productionTurnsLeft: number | null;
  // Progress toward the next population point.
  growthProgress: number;
  // Progress toward the next population point required.
  growthNeeded: number;
}

// How one seat regards another.
export interface SimRelationship {
  // The public value, which is what the world sees.
  publicValue: number;
  // The private value, which is what the seat actually thinks.
  privateValue: number;
  // Whether the two are at war.
  atWar: boolean;
  // The turn the two first met.
  metOnTurn: number;
}

// One seat of the simulated game.
export interface SimSeat {
  // The seat name the harness uses, for example "korea".
  seat: string;
  // The player index in the game.
  playerID: number;
  // The civilization name, for example "Korea".
  civ: string;
  // The leader name, for example "Sejong".
  leader: string;
  // The cities this seat owns, in the order they were founded.
  cities: SimCity[];
  // The treasury.
  gold: number;
  // The happiness value, where a negative number is unhappy.
  happiness: number;
  // Science produced each turn.
  sciencePerTurn: number;
  // Culture produced each turn.
  culturePerTurn: number;
  // Faith produced each turn.
  faithPerTurn: number;
  // Gold produced each turn.
  goldPerTurn: number;
  // Technologies already known.
  techs: string[];
  // The technology being researched, or null when nothing is chosen.
  currentResearch: string | null;
  // Progress toward the current technology.
  researchProgress: number;
  // Policies already adopted.
  policies: string[];
  // Progress toward the next policy.
  policyProgress: number;
  // Whether a policy is waiting to be adopted.
  policyAvailable: boolean;
  // The era the seat has reached.
  era: string;
  // How many military units the seat fields.
  units: number;
  // The seat's military strength.
  militaryStrength: number;
  // The supply the seat can support.
  militarySupply: number;
  // The seat's score.
  score: number;
  // How the seat regards every other seat, keyed by seat name.
  relationships: Record<string, SimRelationship>;
  // The grand strategy the seat has committed to, when it has one.
  grandStrategy: string | null;
  // The economic strategies the seat has committed to.
  economicStrategies: string[];
  // The military strategies the seat has committed to.
  militaryStrategies: string[];
  // The turn this seat last had an opportunity to act.
  lastTurnActed: number;
  // What happened to the actions this seat last committed.
  lastApplied: string[];
}

// Something that happened in the world, which a seat reads as news.
export interface SimEvent {
  // The turn it happened on.
  turn: number;
  // The seat it concerns, or null when it concerns everyone.
  seat: string | null;
  // A short kind, for example "tech" or "city-founded".
  kind: string;
  // The line a seat reads, already written in the game's voice.
  detail: string;
}

// The whole simulated world.
export interface SimState {
  // The game label.
  game: string;
  // The turn the world has advanced to.
  turn: number;
  // The seed the world was generated from, kept so a run can be reproduced.
  seed: number;
  // Seats in turn order.
  order: string[];
  // Every seat, keyed by seat name.
  seats: Record<string, SimSeat>;
  // Everything that has happened, newest last.
  events: SimEvent[];
}

// The rates the simulation advances at. They are knobs rather than constants
// because they are calibrated against a recorded game rather than guessed, and
// a later calibration should be able to change them without touching the rules.
export interface SimConfig {
  // Treasury the seat starts with.
  startGold: number;
  // Gold per turn at the start.
  startGoldPerTurn: number;
  // Gold per turn gained per city.
  goldPerTurnPerCity: number;
  // Science per turn at the start.
  startSciencePerTurn: number;
  // Science per turn gained per population point.
  sciencePerTurnPerPopulation: number;
  // Culture per turn at the start.
  startCulturePerTurn: number;
  // Culture per turn gained per city.
  culturePerTurnPerCity: number;
  // Faith per turn at the start.
  startFaithPerTurn: number;
  // Cost of the first technology.
  firstTechCost: number;
  // Multiplier applied to each successive technology.
  techCostGrowth: number;
  // Cost of the first policy.
  firstPolicyCost: number;
  // Multiplier applied to each successive policy.
  policyCostGrowth: number;
  // Population points the first city needs before it grows.
  firstGrowthNeeded: number;
  // Extra growth needed per population point.
  growthNeededPerPopulation: number;
  // Growth progress added each turn.
  growthPerTurn: number;
  // Military strength at the start.
  startMilitaryStrength: number;
  // Military strength gained each turn.
  militaryPerTurn: number;
  // Military units at the start.
  startUnits: number;
  // Score at the start.
  startScore: number;
  // Score gained each turn.
  scorePerTurn: number;
  // Score added per technology.
  scorePerTech: number;
  // Score added per city.
  scorePerCity: number;
  // Score added per policy.
  scorePerPolicy: number;
  // Turns between new cities after the first.
  turnsBetweenCities: number;
  // The highest number of cities a seat will found on its own.
  maxCities: number;
}
