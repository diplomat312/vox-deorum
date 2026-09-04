# Fresh4 diplomacy record: unprompted coalition politics, T6-T213

All 57 social operations were model-initiated; the only operator messages
are the tagged BATCH4/BATCH4B proofs. Full chronological list with channel
and text in `DIPLOMACY-LOG-FRESH4.txt` (from `node diplo-log.mjs`).
Coalition room: group `096ef627` {Korea, Austria, Siam}, Iroquois excluded.

## Act 1: courtship (T6-T31, bilateral DMs)

Siam opens to Iroquois (T6) and Korea (T8); Korea answers Siam (T11) and
courts Austria (T19); Austria replies (T20). Siam and Iroquois bond over
Jade trade and joint barbarian fighting (T92: "our spears near Sukhothai
hunt barbs only"). No group traffic yet; every pair learns the other's
voice first.

## Act 2: the coalition room comes alive (T32-T104)

The operator-created room is adopted as a genuine war council. Barbarian
pressure dominates: Salzburg holds vs 5 then 7 brutes with coordinated
wall timing (T47-50), Seoul's garrison falls but walls hold (T49),
roll-calls of holding cities, amber-for-gold and cotton trade talk,
"catapults guard, never march" rules of engagement. Tone is warm and
practical; commitments are specific (walls, cities, techs, trades).

## Act 3: first crisis and mediation (T129-T144)

Iroquois spearmen enter Siamese cities as foes. Siam calls for coalition
aid (T129). Korea plays both sides of the table in the same turn window:
public backing for Siam in the room plus a private DM to Hiawatha urging
restraint and offering mediation (T129). Iroquois de-escalates via DM
(T130: spears withdrawn to fight barbs). Room celebrates, explicitly
including Hiawatha (T136-144). Coercion, mediation, and reintegration
with no operator involvement.

## Act 4: collective defense (T194-T197, latest)

Iroquois takes Innsbruck from Austria. The room pivots to retaliation:
cross-denunciations, declared force lists (knights, Hwachas, Turtle
Ships, elephants, trebuchets, longswords), and a coordinated retake
("Vienna gives word: retake Innsbruck now"). Iroquois, outside the
room, says nothing in public channels.

## Notes for harness review

- Iroquois speaks only in bilateral DMs (4 ops), never world or room:
  correct exclusion behavior, and a natural control case.
- T11 Korea sent the same greeting twice (legacy `dm:Siam` + `dm:2`
  forms): one message, two budget ops. Dedupe or alias at the form
  layer.
- T92's Iroquois reassurance ("spears hunt barbs only") precedes the
  T129 invasion: whether deception or changed minds, the transcript
  preserves the receipts. This is the kind of continuity the persistent
  session design exists to support.
- No deals were proposed in 213 turns despite deal tooling being
  advertised: messaging carries the whole relationship. Deal-wiring
  uptake is the next behavioral question.
