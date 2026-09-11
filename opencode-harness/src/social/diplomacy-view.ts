// The view of diplomacy a seat is shown when its observation is rendered.
// Delivery is cursor based: a seat sees what arrived since it last looked, and
// rendering the observation is the moment it looks. Turn watermarks are
// deliberately not used, because a message that arrives in the same turn the
// seat acted would then never be shown to it.

import { getCursor, readInbox, setCursor, type SocialEntry } from "./social-store.js";

// One message a seat is being shown.
export interface DiplomacyMessage {
  // The entry id inside the run.
  id: string;
  // The seat that sent it.
  from: string;
  // What kind of operation produced it.
  kind: string;
  // The message body, when there is one.
  text: string | null;
  // The scope, for example "world", "dm:a:b" or "group:g-3".
  scope: string | null;
}

// A group a seat belongs to or has been invited to.
export interface DiplomacyGroup {
  // The group name given when it was created.
  name: string;
  // Seats that have accepted membership.
  members: string[];
  // Seats invited but not yet accepted.
  invites: string[];
}

// A deal a seat can see. The simulated environment does not negotiate deals
// yet, so this stays empty until the deal layer lands.
export interface DiplomacyDeal {
  // The deal id.
  id: string;
  // The seat that proposed it.
  from: string;
  // A one line description of the terms.
  terms: string;
}

// What a world needs in order to render the diplomacy part of an observation.
export interface DiplomacyView {
  // Messages the seat has not seen yet. Advances that seat's cursor.
  deliverMessages(seat: string): Promise<DiplomacyMessage[]>;
  // The groups the seat belongs to or has been invited to.
  groupsFor(seat: string): Promise<DiplomacyGroup[]>;
  // The deals the seat can see.
  dealsFor(seat: string): Promise<DiplomacyDeal[]>;
}

// Read the group state from the entries a seat can see.
function groupsFrom(entries: SocialEntry[]): DiplomacyGroup[] {
  const byId = new Map<string, DiplomacyGroup>();
  for (const entry of entries) {
    if (entry.kind === "group-create") {
      const id = entry.group ?? entry.id;
      if (!byId.has(id)) byId.set(id, { name: entry.name ?? id, members: [entry.from], invites: [] });
    } else if (entry.kind === "invite") {
      const id = entry.group ?? "";
      const group = byId.get(id);
      if (group && entry.to && !group.invites.includes(entry.to)) group.invites.push(entry.to);
    } else if (entry.kind === "accept") {
      const id = entry.group ?? "";
      const group = byId.get(id);
      if (group) {
        group.invites = group.invites.filter((seat) => seat !== entry.from);
        if (!group.members.includes(entry.from)) group.members.push(entry.from);
      }
    } else if (entry.kind === "leave") {
      const id = entry.group ?? "";
      const group = byId.get(id);
      if (group) group.members = group.members.filter((seat) => seat !== entry.from);
    }
  }
  return [...byId.values()];
}

// Build the diplomacy view over a run's social log.
export function socialDiplomacyView(directory: string): DiplomacyView {
  return {
    // Read what arrived since the seat last looked, then move the cursor up.
    // The cursor is stored per seat, so a restart neither replays nor skips.
    async deliverMessages(seat: string): Promise<DiplomacyMessage[]> {
      const page = await readInbox(directory, seat);
      const cursor = await getCursor(directory, seat);
      if (page.cursor !== cursor) await setCursor(directory, seat, page.cursor);
      return page.messages.map((entry) => ({
        id: entry.id,
        from: entry.from,
        kind: entry.kind,
        text: entry.text ?? null,
        scope: entry.to ?? null
      }));
    },
    // Groups are read from everything the seat can see, without moving the
    // cursor, because membership is state rather than an event.
    async groupsFor(seat: string): Promise<DiplomacyGroup[]> {
      const page = await readInbox(directory, seat);
      return groupsFrom(page.messages);
    },
    // Deals arrive with the deal layer.
    async dealsFor(): Promise<DiplomacyDeal[]> {
      return [];
    }
  };
}
