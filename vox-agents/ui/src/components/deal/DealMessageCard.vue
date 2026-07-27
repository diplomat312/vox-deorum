<!--
Component: DealMessageCard
Purpose: Inline rendering of a deal proposal inside the conversation stream (the second deal
surface, alongside the configuring dialog). The card is the whole lifecycle of one proposal: its
terms (you give / they give), the proposal-time value to you, and its resolved outcome. The
answering `deal-accept` / `deal-reject` / `deal-enacted` rows are *not* rendered as cards of their
own — the parent filters them out and feeds them here as this proposal's outcome, so one deal reads
as one card instead of scattering across three entries. Accept / Reject act inline; Counter opens
the dialog (the parent loads the active proposal there). Accepting a deal enacts it for real
in-game (stage 6): the enactment route transfers its trade items and applies its promise
commitments, then records the agreement.
-->
<template>
  <div class="deal-card" :class="{ 'deal-card-mine': mine }">
    <div class="deal-card-head">
      <i class="pi" :class="headIcon" />
      <span class="deal-card-title">{{ headline }}</span>
      <span class="deal-card-turn">turn {{ deal.Turn }}</span>
    </div>

    <div v-if="dealMessage" class="deal-card-message">“{{ dealMessage }}”</div>
    <!-- Two aligned columns ("You give" | "They give"), mirroring the deal screen's central
         offer: each side lists the items it gives then the promises it pledges. -->
    <div class="deal-card-columns">
      <div v-for="col in columns" :key="col.sideID" class="deal-card-col">
        <div class="deal-card-col-title">{{ col.label }} give</div>
        <ul class="deal-card-list">
          <li v-for="(label, i) in col.itemLabels" :key="`item-${i}`">{{ label }}</li>
          <li v-for="(label, i) in col.promiseLabels" :key="`promise-${i}`" class="deal-card-promise">{{ label }}</li>
          <li v-if="col.itemLabels.length === 0 && col.promiseLabels.length === 0" class="deal-card-empty">— nothing —</li>
        </ul>
      </div>
    </div>
    <div v-if="valueText" class="deal-card-value">value to {{ youLabel }}: {{ valueText }}</div>

    <!-- The answering side's own words. `deal-enacted` is boilerplate the status label already
         says, so only accept/reject lines appear here. -->
    <div v-for="line in outcomeLines" :key="line.id" class="deal-card-outcome">{{ line.text }}</div>

    <div v-if="canAct" class="deal-card-actions">
      <template v-if="mine">
        <Button label="Counter" size="small" outlined icon="pi pi-replay" :disabled="busy" @click="$emit('counter', deal.ID)" />
        <Button label="Retract" size="small" text severity="danger" icon="pi pi-times-circle" :disabled="busy" @click="$emit('reject', deal.ID)" />
      </template>
      <template v-else>
        <Button label="Accept" size="small" severity="success" icon="pi pi-check" :disabled="busy" @click="$emit('accept', deal.ID)" />
        <Button label="Counter" size="small" outlined icon="pi pi-replay" :disabled="busy" @click="$emit('counter', deal.ID)" />
        <Button label="Reject" size="small" text severity="danger" icon="pi pi-times-circle" :disabled="busy" @click="$emit('reject', deal.ID)" />
      </template>
    </div>
    <div v-else-if="statusNote" class="deal-card-status" :class="statusClass">{{ statusNote }}</div>
    <div v-else-if="superseded" class="deal-card-superseded">superseded</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import type { DealTranscriptMessage, TradeItem, PromiseTerm, ProposalOutcome } from '@/utils/types';
import { formatItemLabel, formatPromiseLabel, formatBalance, storedBalanceToSide } from '@/utils/deal/deal-helpers';
import { offerColumnsFor } from '@/utils/deal/deal-catalog';

const props = withDefaults(defineProps<{
  /** A `deal-proposal` or `deal-counter` row. Outcome rows never reach this component. */
  deal: DealTranscriptMessage;
  /** The viewer ("you") endpoint — the audience/human seat. */
  youID: number;
  /** The other endpoint — the LLM-voiced seat. */
  themID: number;
  youLabel: string;
  themLabel: string;
  /** This proposal's resolved lifecycle, from `deriveProposalOutcomes`. Absent while a freshly
   *  spliced optimistic row has not been reduced yet, which reads as an unanswered proposal. */
  outcome?: ProposalOutcome;
  /** Closed-this-turn lock disables actions. */
  locked?: boolean;
  /** Another deal action is already in flight from this conversation surface. */
  busy?: boolean;
}>(), { busy: false });

defineEmits<{ (e: 'accept', id: number): void; (e: 'reject', id: number): void; (e: 'counter', id: number): void }>();

const status = computed(() => props.outcome?.status ?? 'open');
const superseded = computed(() => props.outcome?.superseded ?? false);

/** Only the proposal still on the table can be acted on, and only while nothing has answered it. */
const canAct = computed(() => !superseded.value && status.value === 'open' && !props.locked);

/** Every resolved proposal shows its own outcome, including ones a later proposal has replaced —
 *  otherwise an accepted deal would silently revert to "superseded" once the conversation moved on. */
const statusNote = computed(() => {
  switch (status.value) {
    case 'rejected': return 'Rejected';
    case 'accepted': return 'Accepted';
    case 'enacted': return 'Enacted';
    default: return '';
  }
});
const statusClass = computed(() => (status.value === 'rejected' ? 'status-rejected' : 'status-done'));

/** Authored by the viewer ("you") — an outgoing offer, so Counter/Retract rather than Accept. */
const mine = computed(() => props.deal.SpeakerID === props.youID);

/** Accept and reject rows can carry an authored line; `deal-enacted` is fixed boilerplate that the
 *  status label already conveys, so it is dropped rather than repeated under the terms. */
const outcomeLines = computed(() =>
  (props.outcome?.responses ?? [])
    .filter((r) => r.MessageType !== 'deal-enacted')
    .map((r) => ({ id: r.ID, text: r.Content?.trim() ?? '' }))
    .filter((line) => line.text.length > 0)
);

const headIcon = computed(() => (props.deal.MessageType === 'deal-counter' ? 'pi-replay' : 'pi-briefcase'));
const headline = computed(() => {
  const who = mine.value ? 'You' : props.themLabel;
  return props.deal.MessageType === 'deal-counter' ? `${who} countered` : `${who} proposed a deal`;
});

/** The one-sentence outward line carried on the draft deal. */
const dealMessage = computed(() => props.deal.Payload.Deal?.message ?? '');

const items = computed<TradeItem[]>(() => props.deal.Payload.Deal?.items ?? []);
const promises = computed<PromiseTerm[]>(() => props.deal.Payload.Deal?.promises ?? []);

/** The two giver columns ("You give" | "They give"), each carrying the side's item labels then
 *  its pledged-promise labels — the compact, read-only mirror of the deal screen's central offer
 *  (no editors/targets, so labels use the graceful no-range/no-target fallbacks). */
const columns = computed(() =>
  offerColumnsFor(items.value, promises.value, [
    { sideID: props.youID, label: props.youLabel },
    { sideID: props.themID, label: props.themLabel },
  ]).map(({ sideID, label, items: columnItems, promises: columnPromises }) => ({
    sideID,
    label,
    itemLabels: columnItems.map(({ item }) => formatItemLabel(item)),
    promiseLabels: columnPromises.map(({ promise }) => formatPromiseLabel(promise)),
  }))
);

const valueText = computed(() => {
  const balance = storedBalanceToSide(
    items.value,
    props.deal.Payload.Value1,
    props.deal.Payload.Value2,
    props.deal.Player1ID,
    props.deal.Player2ID,
    props.youID
  );
  if (!balance) return '';
  return formatBalance(balance);
});
</script>

<style scoped>
.deal-card {
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--p-primary-color);
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  margin: 0.35rem 0;
  background: var(--p-content-background);
  font-size: 0.9rem;
}
.deal-card-mine { border-left-color: var(--p-surface-400); }
.deal-card-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
.deal-card-title { font-weight: 600; }
.deal-card-turn { margin-left: auto; font-size: 0.75rem; color: var(--p-text-muted-color); }
/* You give | They give — the compact two-column mirror of the deal screen's central offer. */
.deal-card-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 0.2rem 0; }
.deal-card-col { min-width: 0; }
.deal-card-col-title { color: var(--p-text-muted-color); font-size: 0.78rem; font-weight: 600; margin-bottom: 0.2rem; }
.deal-card-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.deal-card-list li { font-size: 0.85rem; word-break: break-word; }
.deal-card-promise { color: var(--p-text-muted-color); }
.deal-card-empty { color: var(--p-text-muted-color); font-size: 0.8rem; }
.deal-card-message { font-style: italic; margin-bottom: 0.3rem; }
.deal-card-value { font-size: 0.8rem; color: var(--p-text-muted-color); margin-top: 0.25rem; }
.deal-card-outcome { font-size: 0.85rem; font-style: italic; margin-top: 0.3rem; }
.deal-card-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
.deal-card-superseded { font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.35rem; font-style: italic; }
.deal-card-status { font-size: 0.8rem; font-weight: 600; margin-top: 0.35rem; }
.status-rejected { color: var(--p-red-500); }
.status-done { color: var(--p-green-500); }
</style>
