<script setup lang="ts">
/**
 * CivilizationMindsDialog presents live player assignments and unified-mind telemetry in one
 * compact surface. It reads existing session, player-summary, and telemetry APIs without creating
 * a second source of truth for game state.
 */

import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { api } from '@/api/client';
import { activeSessions, refreshActiveSessions, startActiveSessionPolling } from '@/stores/telemetry';
import { formatDuration, formatTimestamp, formatTokenCount, parseSpanAttributes } from '@/api/telemetry-utils';
import type { PlayerAssignment, Span, TelemetrySession } from '@/utils/types';
import AgentSelectDialog from '@/components/chat/launch/AgentSelectDialog.vue';

interface Props {
  visible: boolean;
}

interface Emits {
  (event: 'update:visible', value: boolean): void;
}

interface PlayerSnapshot {
  Civilization?: string;
  Leader?: string;
  Score?: number;
  CurrentResearch?: string;
  DiplomaticDeals?: Record<string, DealSnapshot[]>;
}

interface DealSnapshot {
  TurnsRemaining?: number;
}

interface TimelineItem {
  span: Span;
  wake: string;
  outcome: string;
  model: string;
  provider: string;
  counterpart: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface MindCard {
  playerId: string;
  civilization: string;
  leader: string;
  architecture: string;
  model: string;
  provider: string;
  activity: 'Idle' | 'Reasoning';
  lastWake: string;
  lastTurn: string;
  outcome: string;
  assignment?: PlayerAssignment;
  snapshot: PlayerSnapshot;
  timeline: TimelineItem[];
  session?: TelemetrySession;
}

type AttributeValue = string | number | boolean | null;
type ReadableAttributes = Record<string, AttributeValue>;

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const router = useRouter();

const loading = ref(false);
const error = ref<string | null>(null);
const playersData = ref<Record<string, PlayerSnapshot>>({});
const assignments = ref<Record<number, PlayerAssignment>>({});
const spansByPlayer = ref<Record<string, Span[]>>({});
const lastUpdated = ref<Date | null>(null);
const selectedPlayerId = ref<string | null>(null);
const talkVisible = ref(false);
const talkContextId = ref<string | undefined>(undefined);
let pollInterval: number | null = null;
let releaseSessionPolling: (() => void) | null = null;

/** Keep the dialog visibility controlled by its parent. */
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});

/** Convert telemetry attributes into a narrow, safe reader shape for display. */
function readableAttributes(span: Span): ReadableAttributes {
  return parseSpanAttributes(span).attributes as ReadableAttributes;
}

/** Read a textual telemetry attribute without exposing raw telemetry objects to the template. */
function textAttribute(attributes: ReadableAttributes, ...names: string[]): string {
  for (const name of names) {
    const value = attributes[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** Read a numeric telemetry attribute when a provider reported one. */
function numberAttribute(attributes: ReadableAttributes, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = attributes[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Identify the three unified wake spans that are meaningful in the player-facing view. */
function isUnifiedWake(span: Span): boolean {
  const attributes = readableAttributes(span);
  return attributes['mind.mode'] === 'unified-mind' && ['strategic', 'diplomacy', 'deal'].includes(textAttribute(attributes, 'mind.wake'));
}

/** Detect an in-flight span without treating the last completed error as a permanent activity state. */
function isActiveSpan(span: Span): boolean {
  return !Number.isFinite(span.endTime) || span.endTime <= span.startTime || span.endTime === 0;
}

/** Map an internal wake name to the player-facing label. */
function wakeLabel(wake: string): string {
  if (wake === 'strategic') return 'Strategy';
  if (wake === 'diplomacy') return 'Diplomacy';
  if (wake === 'deal') return 'Deal';
  return 'Unknown';
}

/** Map explicit telemetry outcomes to stable player-facing labels. */
function outcomeLabel(outcome: string): string {
  if (outcome === 'spoke') return 'Spoke';
  if (outcome === 'pass' || outcome === 'keep-status-quo') return 'Passed';
  if (outcome === 'deal') return 'Deal action';
  if (outcome === 'close') return 'Closed conversation';
  if (outcome === 'error') return 'Error';
  return outcome ? outcome : 'Unknown';
}

/** Make provider model identifiers readable while preserving the raw value in developer details. */
function friendlyModel(model: string): string {
  if (!model) return 'Model not configured';
  const shortName = model.split('/').pop()?.replace(/:free$/, '') ?? model;
  const knownLabels: Record<string, string> = {
    'minimax-m3': 'MiniMax M3',
    'mimo-v2.5': 'MiMo V2.5',
    'muse-spark-1.2-contributor': 'Muse Spark 1.2 Contributor',
  };
  if (knownLabels[shortName]) return knownLabels[shortName];
  return shortName.replace(/[-_]/g, ' ');
}

/** Resolve the provider portion of a configured model identifier for compact display. */
function modelProvider(model: string, attributes: ReadableAttributes): string {
  const telemetryProvider = textAttribute(attributes, 'provider', 'model.provider');
  if (telemetryProvider) return telemetryProvider;
  return model.includes('/') ? (model.split('/')[0] ?? 'Configured provider') : 'Configured provider';
}

/** Convert one span into the sanitized timeline record shown in the inspector. */
function timelineItem(span: Span, fallbackModel: string): TimelineItem {
  const attributes = readableAttributes(span);
  const model = textAttribute(attributes, 'mind.model', 'model') || fallbackModel;
  return {
    span,
    wake: wakeLabel(textAttribute(attributes, 'mind.wake')),
    outcome: outcomeLabel(textAttribute(attributes, 'mind.outcome') || (span.statusCode === 2 ? 'error' : '')),
    model: friendlyModel(model),
    provider: modelProvider(model, attributes),
    counterpart: textAttribute(attributes, 'mind.counterpart', 'diplomacy.counterpart', 'counterpart'),
    inputTokens: numberAttribute(attributes, 'usage.input_tokens', 'usage.prompt_tokens', 'prompt_tokens'),
    outputTokens: numberAttribute(attributes, 'usage.output_tokens', 'usage.completion_tokens', 'completion_tokens'),
  };
}

/** Return the active telemetry session associated with one actual player seat. */
function sessionForPlayer(playerId: string): TelemetrySession | undefined {
  return activeSessions.value.find(session => session.playerID === playerId);
}

/** Count currently open durable deal entries in the existing player summary. */
function openDealCount(snapshot: PlayerSnapshot): number {
  return Object.values(snapshot.DiplomaticDeals ?? {}).reduce((count, deals) => {
    return count + deals.filter(deal => (deal.TurnsRemaining ?? 0) > 0).length;
  }, 0);
}

/** Build the card model from authoritative player, assignment, session, and span data. */
function buildCard(playerId: string, snapshot: PlayerSnapshot, assignment?: PlayerAssignment): MindCard {
  const session = sessionForPlayer(playerId);
  const wakeSpans = (spansByPlayer.value[playerId] ?? []).filter(isUnifiedWake).sort((a, b) => a.startTime - b.startTime);
  const timeline = wakeSpans.slice(-40).map(span => timelineItem(span, assignment?.mindModel ?? assignment?.model ?? ''));
  const lastSpan = wakeSpans.length > 0 ? wakeSpans[wakeSpans.length - 1] : undefined;
  const lastAttributes = lastSpan ? readableAttributes(lastSpan) : {};
  const lastOutcome = lastSpan
    ? outcomeLabel(textAttribute(lastAttributes, 'mind.outcome') || (lastSpan.statusCode === 2 ? 'error' : ''))
    : 'Unknown';
  const active = wakeSpans.some(isActiveSpan);
  const isUnified = assignment?.mind === 'unified-mind';
  const architecture = isUnified
    ? 'Unified Civilization Mind'
    : assignment?.strategist === 'human-strategist'
      ? 'Human strategist'
      : assignment
        ? 'Legacy AI'
        : 'Native Civ / Vox Populi';
  const model = assignment?.mindModel ?? assignment?.model ?? '';

  return {
    playerId,
    civilization: snapshot.Civilization ?? `Player ${playerId}`,
    leader: snapshot.Leader ?? 'Unknown leader',
    architecture,
    model: friendlyModel(model),
    provider: modelProvider(model, lastAttributes),
    activity: active ? 'Reasoning' : 'Idle',
    lastWake: lastSpan ? wakeLabel(textAttribute(lastAttributes, 'mind.wake')) : 'None recorded',
    lastTurn: lastSpan?.turn === null || lastSpan?.turn === undefined ? 'Unknown' : String(lastSpan.turn),
    outcome: lastOutcome,
    assignment,
    snapshot,
    timeline,
    session,
  };
}

/** Return all known seats in stable seat order, including assignments without a player report. */
const playerIds = computed(() => {
  const ids = new Set<string>(Object.keys(playersData.value));
  for (const playerId of Object.keys(assignments.value)) ids.add(playerId);
  for (const session of activeSessions.value) {
    if (session.playerID) ids.add(session.playerID);
  }
  return [...ids].sort((left, right) => Number(left) - Number(right));
});

/** Build the current civilization card collection for the main dialog. */
const cards = computed(() => playerIds.value.map(playerId => buildCard(
  playerId,
  playersData.value[playerId] ?? {},
  assignments.value[Number(playerId)],
)));

/** Resolve the card selected for the single unified history inspector. */
const selectedCard = computed(() => cards.value.find(card => card.playerId === selectedPlayerId.value) ?? null);

/** Load player assignments and sanitized wake telemetry for the active game. */
async function loadMinds(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [playersResponse] = await Promise.all([api.getPlayersSummary(), refreshActiveSessions()]);
    const nextPlayers: Record<string, PlayerSnapshot> = {};
    for (const [playerId, data] of Object.entries(playersResponse.players)) {
      if (typeof data === 'object' && data !== null) nextPlayers[playerId] = data as PlayerSnapshot;
    }
    playersData.value = nextPlayers;
    assignments.value = playersResponse.assignments ?? {};

    const nextSpans: Record<string, Span[]> = {};
    await Promise.all(activeSessions.value.filter(session => session.playerID).map(async session => {
      try {
        const response = await api.getSessionSpans(session.sessionId);
        nextSpans[session.playerID!] = response.spans;
      } catch {
        nextSpans[session.playerID!] = [];
      }
    }));
    spansByPlayer.value = nextSpans;
    lastUpdated.value = new Date();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Failed to load civilization minds';
  } finally {
    loading.value = false;
  }
}

/** Close the inspector and return to the civilization card collection. */
function closeInspector(): void {
  selectedPlayerId.value = null;
}

/** Open the inspector for one civilization without exposing private transcript content. */
function openInspector(playerId: string): void {
  selectedPlayerId.value = playerId;
}

/** Navigate to the existing sanitized telemetry session when a developer wants more detail. */
function openTelemetry(card: MindCard): void {
  if (!card.session) return;
  dialogVisible.value = false;
  router.push({ name: 'telemetry-session', params: { sessionId: card.session.sessionId } });
}

/** Open the existing diplomacy launcher for a unified civilization target. */
function openTalk(card: MindCard): void {
  if (!card.session) return;
  talkContextId.value = card.session.sessionId;
  talkVisible.value = true;
}

/** Format the last refresh age without adding a second clock or persistence layer. */
function refreshAge(): string {
  if (!lastUpdated.value) return '';
  const seconds = Math.floor((Date.now() - lastUpdated.value.getTime()) / 1000);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/** Release polling and timers when the dialog is closed or unmounted. */
function releasePolling(): void {
  releaseSessionPolling?.();
  releaseSessionPolling = null;
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

watch(dialogVisible, visible => {
  if (visible) {
    void loadMinds();
    releaseSessionPolling = startActiveSessionPolling();
    pollInterval = window.setInterval(() => void loadMinds(), 10_000);
  } else {
    releasePolling();
    closeInspector();
  }
});

onUnmounted(releasePolling);
</script>

<template>
  <Dialog v-model:visible="dialogVisible" modal :closable="true" :dismissableMask="true" :style="{ width: '86vw', minWidth: '760px' }" @hide="closeInspector">
    <template #header>
      <div class="header-content">
        <div>
          <h2>Civilization Minds</h2>
          <p class="header-subtitle">One political mind can own strategy, diplomacy, and deals.</p>
        </div>
        <span v-if="lastUpdated" class="last-updated">{{ refreshAge() }}</span>
      </div>
    </template>

    <div v-if="loading && cards.length === 0" class="loading-container">
      <ProgressSpinner />
      <p>Loading civilization minds...</p>
    </div>

    <div v-else-if="error" class="error-container">
      <i class="pi pi-exclamation-triangle"></i>
      <p>{{ error }}</p>
      <Button label="Retry" @click="loadMinds" />
    </div>

    <div v-else-if="selectedCard" class="mind-inspector">
      <div class="inspector-heading">
        <Button label="Back to minds" icon="pi pi-arrow-left" severity="secondary" text @click="closeInspector" />
        <div>
          <h3>{{ selectedCard.leader }} of {{ selectedCard.civilization }}</h3>
          <p>{{ selectedCard.architecture }} · {{ selectedCard.model }}</p>
        </div>
        <Tag :value="selectedCard.activity" :severity="selectedCard.activity === 'Reasoning' ? 'info' : 'secondary'" />
      </div>

      <div class="inspector-facts">
        <div><span>Seat</span><strong>{{ selectedCard.playerId }}</strong></div>
        <div><span>Last wake</span><strong>{{ selectedCard.lastWake }} · Turn {{ selectedCard.lastTurn }}</strong></div>
        <div><span>Last outcome</span><strong>{{ selectedCard.outcome }}</strong></div>
        <div><span>Score</span><strong>{{ selectedCard.snapshot.Score ?? 'Not available' }}</strong></div>
        <div><span>Current research</span><strong>{{ selectedCard.snapshot.CurrentResearch ?? 'Not available' }}</strong></div>
        <div><span>Open deals</span><strong>{{ openDealCount(selectedCard.snapshot) }}</strong></div>
      </div>

      <section class="inspector-section">
        <h4>Activity timeline</h4>
        <div v-if="selectedCard.timeline.length === 0" class="empty-copy">No unified wake telemetry recorded yet.</div>
        <div v-for="item in selectedCard.timeline" :key="item.span.spanId" class="timeline-item">
          <div class="timeline-main"><strong>{{ item.wake }}</strong><Tag :value="item.outcome" severity="secondary" /><span>Turn {{ item.span.turn ?? 'unknown' }}</span></div>
          <div class="timeline-meta">{{ formatTimestamp(item.span.startTime) }} · {{ formatDuration(item.span.durationMs) }} · {{ item.model }} · {{ item.provider }}</div>
          <div v-if="item.counterpart" class="timeline-meta">Counterpart: {{ item.counterpart }}</div>
          <div v-if="item.inputTokens !== undefined || item.outputTokens !== undefined" class="timeline-meta">Tokens: {{ formatTokenCount(item.inputTokens) }} in / {{ formatTokenCount(item.outputTokens) }} out</div>
        </div>
      </section>

      <section class="inspector-section">
        <h4>Recent diplomacy</h4>
        <p class="empty-copy">Only sanitized wake metadata is shown here. Private transcript bodies stay behind their existing visibility rules.</p>
      </section>

      <details class="developer-details">
        <summary>Developer details</summary>
        <p>Strategist: {{ selectedCard.assignment?.strategist ?? 'not assigned' }}</p>
        <p>Diplomacy adapter: {{ selectedCard.assignment?.diplomat ?? 'not assigned' }}</p>
        <p>Deal adapter: {{ selectedCard.assignment?.negotiator ?? 'not assigned' }}</p>
        <p>Telemetry session: {{ selectedCard.session?.sessionId ?? 'not active' }}</p>
      </details>
      <Button v-if="selectedCard.session" label="Open telemetry" icon="pi pi-chart-line" text @click="openTelemetry(selectedCard)" />
    </div>

    <div v-else class="mind-grid">
      <div v-if="cards.length === 0" class="table-empty"><i class="pi pi-inbox"></i><p>No civilization seats found.</p></div>
      <article v-for="card in cards" :key="card.playerId" class="mind-card">
        <div class="card-heading">
          <div>
            <h3>{{ card.civilization }}</h3>
            <p>{{ card.leader }} · Seat {{ card.playerId }}</p>
          </div>
          <Tag :value="card.activity" :severity="card.activity === 'Reasoning' ? 'info' : 'secondary'" />
        </div>
        <div class="architecture" :class="{ unified: card.assignment?.mind === 'unified-mind' }">{{ card.architecture }}</div>
        <div class="card-fact"><span>Model</span><strong>{{ card.model }}</strong></div>
        <div v-if="card.assignment?.mind === 'unified-mind'" class="unified-fact">Strategy · Diplomacy · Deals same civilization mind</div>
        <div class="card-fact"><span>Last wake</span><strong>{{ card.lastWake }} · Turn {{ card.lastTurn }}</strong></div>
        <div class="card-fact"><span>Outcome</span><strong>{{ card.outcome }}</strong></div>
        <div class="card-actions">
          <Button label="Open Mind" size="small" outlined @click="openInspector(card.playerId)" />
          <Button v-if="card.assignment?.mind === 'unified-mind'" label="Talk" icon="pi pi-comments" size="small" @click="openTalk(card)" />
          <span v-else class="legacy-note">Legacy controls</span>
        </div>
      </article>
    </div>
  </Dialog>
  <AgentSelectDialog
    v-model:visible="talkVisible"
    :context-id="talkContextId"
    initial-conversation-mode="diplomacy"
  />
</template>

<style scoped>
.header-content { display: flex; align-items: flex-start; gap: 1rem; width: 100%; }
.header-content h2, .card-heading h3, .inspector-heading h3 { margin: 0; }
.header-subtitle, .card-heading p, .inspector-heading p { margin: 0.25rem 0 0; color: var(--p-text-secondary-color); }
.last-updated { margin-left: auto; color: var(--p-text-secondary-color); font-size: 0.875rem; }
.mind-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 0.85rem; }
.mind-card { border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: 1rem; background: var(--p-content-background); }
.card-heading, .inspector-heading, .card-actions, .timeline-main { display: flex; align-items: center; gap: 0.6rem; }
.card-heading { justify-content: space-between; align-items: flex-start; }
.architecture { margin: 0.8rem 0; color: var(--p-text-secondary-color); font-size: 0.9rem; }
.architecture.unified { color: var(--p-primary-color); font-weight: 600; }
.card-fact { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.35rem 0; font-size: 0.9rem; }
.card-fact span, .inspector-facts span { color: var(--p-text-secondary-color); }
.card-fact strong { text-align: right; }
.unified-fact { margin: 0.4rem 0; font-size: 0.78rem; color: var(--p-primary-color); }
.card-actions { margin-top: 0.8rem; }
.legacy-note { margin-left: auto; color: var(--p-text-secondary-color); font-size: 0.78rem; }
.inspector-heading { margin-bottom: 1rem; }
.inspector-heading > div { flex: 1; }
.inspector-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.7rem; margin-bottom: 1rem; }
.inspector-facts div { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.65rem; background: var(--p-surface-50); border-radius: 6px; }
.inspector-section { margin-top: 1rem; }
.inspector-section h4 { margin: 0 0 0.6rem; }
.timeline-item { border-left: 2px solid var(--p-primary-color); padding: 0.55rem 0 0.55rem 0.8rem; margin-left: 0.3rem; }
.timeline-main span { color: var(--p-text-secondary-color); font-size: 0.8rem; }
.timeline-meta, .empty-copy, .developer-details { color: var(--p-text-secondary-color); font-size: 0.82rem; }
.timeline-meta { margin-top: 0.25rem; }
.developer-details { margin-top: 1rem; }
.developer-details p { margin: 0.35rem 0; }
</style>
