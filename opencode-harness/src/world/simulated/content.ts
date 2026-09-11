// The content a simulated game draws on: civilizations, their city lists, the
// early technology and policy trees, and the eras. Names are the real ones, so
// a seat reads a situation that looks and sounds like the game it is imitating.
//
// This is a small slice of the real trees. It only needs to be wide enough that
// a seat's choices are meaningful and narrow enough to stay legible.

// A playable civilization.
export interface CivDefinition {
  // The seat name the harness uses.
  seat: string;
  // The civilization name as the game writes it.
  civ: string;
  // The leader name as the game writes it.
  leader: string;
  // City names in the order they are founded.
  cityNames: string[];
}

// The civilizations a simulated game can seat, in a fixed order so a seed
// always produces the same table.
export const civDefinitions: CivDefinition[] = [
  { seat: "korea", civ: "Korea", leader: "Sejong", cityNames: ["Seoul", "Busan", "Jeonju", "Daegu", "Pyongyang"] },
  { seat: "austria", civ: "Austria", leader: "Maria Theresa", cityNames: ["Vienna", "Salzburg", "Graz", "Linz", "Klagenfurt"] },
  { seat: "siam", civ: "Siam", leader: "Ramkhamhaeng", cityNames: ["Sukhothai", "Si Satchanalai", "Muang Saluang", "Lampang", "Phitsanulok"] },
  { seat: "iroquois", civ: "Iroquois", leader: "Hiawatha", cityNames: ["Onondaga", "Osininka", "Grand River", "Akwesasme", "Buffalo Creek"] },
  { seat: "morocco", civ: "Morocco", leader: "Ahmad al-Mansur", cityNames: ["Marrakech", "Fez", "Tangier", "Casablanca", "Rabat"] },
  { seat: "sweden", civ: "Sweden", leader: "Gustavus Adolphus", cityNames: ["Stockholm", "Uppsala", "Gothenburg", "Malmo", "Linkoping"] }
];

// The early technology tree, in the order the game reveals it. A later
// technology is only offered once the ones before it are known.
export const earlyTechs: string[] = [
  "Pottery",
  "Animal Husbandry",
  "Mining",
  "Trapping",
  "The Wheel",
  "Archery",
  "Writing",
  "Calendar",
  "Bronze Working",
  "Philosophy",
  "Construction",
  "Currency",
  "Iron Working",
  "Theology",
  "Civil Service",
  "Compass",
  "Education",
  "Metal Casting",
  "Machinery",
  "Guilds",
  "Chivalry",
  "Banking",
  "Printing Press",
  "Astronomy"
];

// The policy trees a seat may open, and the policies inside them.
export const policyTrees: Record<string, string[]> = {
  Tradition: ["Tradition Opener", "Aristocracy", "Oligarchy", "Legalism", "Landed Elite", "Monarchy"],
  Liberty: ["Liberty Opener", "Collective Rule", "Citizenship", "Republic", "Representation", "Meritocracy"],
  Honor: ["Honor Opener", "Warrior Code", "Discipline", "Military Tradition", "Military Caste", "Professional Army"],
  Piety: ["Piety Opener", "Organized Religion", "Mandate of Heaven", "Theocracy", "Religious Tolerance"],
  Patronage: ["Patronage Opener", "Consulates", "Philanthropy", "Scholasticism", "Cultural Diplomacy"]
};

// The eras a seat passes through, in order.
export const eras: string[] = ["Ancient", "Classical", "Medieval", "Renaissance", "Industrial"];

// How many technologies a seat must know before it reaches each era after the
// first. The Ancient era is where a game begins.
export const eraTechnologyThresholds: number[] = [0, 4, 10, 18, 26];

// The grand strategies a seat may commit to.
export const grandStrategies: string[] = ["Conquest", "Culture", "Diplomacy", "Science", "Expansion"];

// The economic strategies a seat may commit to.
export const economicStrategies: string[] = ["Growth", "Production", "Gold", "Trade", "Science"];

// The military strategies a seat may commit to.
export const militaryStrategies: string[] = ["Conquest", "Defense", "Patrol", "Offense", "None"];

// Things a city may build, in the order a seat is offered them. The simulation
// only needs the name and roughly how long it takes, because a seat's decisions
// about production are not what this environment exists to study.
export const buildOptions: Array<{ name: string; cost: number }> = [
  { name: "Monument", cost: 24 },
  { name: "Shrine", cost: 24 },
  { name: "Worker", cost: 30 },
  { name: "Granary", cost: 36 },
  { name: "Library", cost: 40 },
  { name: "Settler", cost: 44 },
  { name: "Archer", cost: 30 },
  { name: "Warrior", cost: 20 },
  { name: "Walls", cost: 50 },
  { name: "Market", cost: 60 }
];

// Find a civilization by seat name.
export function civBySeat(seat: string): CivDefinition {
  const found = civDefinitions.find((entry) => entry.seat === seat);
  if (!found) throw new Error("No civilization is defined for seat '" + seat + "'");
  return found;
}

// The era a seat has reached, given how many technologies it knows.
export function eraForTechCount(techCount: number): string {
  let era = eras[0];
  for (let index = 0; index < eraTechnologyThresholds.length; index += 1) {
    if (techCount >= eraTechnologyThresholds[index]) era = eras[index];
  }
  return era;
}

// The technologies a seat may research next: the first few it does not know.
export function availableTechs(known: string[], limit = 5): string[] {
  return earlyTechs.filter((tech) => !known.includes(tech)).slice(0, limit);
}

// The policies a seat may adopt next, as "Tree: Name" entries.
export function availablePolicies(adopted: string[], limit = 6): string[] {
  const options: string[] = [];
  for (const [tree, policies] of Object.entries(policyTrees)) {
    for (const policy of policies) {
      const label = tree + " " + policy;
      if (!adopted.includes(label) && !adopted.includes(policy)) options.push(label);
      if (options.length >= limit) return options;
    }
  }
  return options;
}
