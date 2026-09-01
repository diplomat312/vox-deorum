<script setup lang="ts">
/**
 * CivilizationMindsDialog presents the server's canonical civilization-mind read model. It does
 * not reconstruct activity by joining telemetry, session, and player-summary responses in the UI.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { api } from '@/api/client';
import { formatDuration, formatTimestamp, formatTokenCount } from '@/api/telemetry-utils';
import type { CivilizationMindReadModel, CivilizationMindWakeRecord } from '@/utils/types';
import AgentSelectDialog from '@/components/chat/launch/AgentSelectDialog.vue';

interface MindCard {
  source: CivilizationMindReadModel;
  playerId: string;
  civilization: string;
  leader: string;
  architecture: string;
  model: string;
  activity: string;
  lastWake: string;
  lastTurn: string;
  outcome: string;
  timeline: CivilizationMindWakeRecord[];
}

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
const router = useRouter();
const loading = ref(false);
const error = ref<string | null>(null);
const minds = ref<CivilizationMindReadModel[]>([]);
const lastUpdated = ref<Date | null>(null);
const selectedPlayerId = ref<string | null>(null);
const talkVisible = ref(false);
const talkContextId = ref<string | undefined>();
let pollInterval: number | null = null;

/** Keep the dialog visibility controlled by its parent. */
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});

/** Format a model reference without hiding the original value from developer details. */
function friendlyModel(model?: string): string {
  if (!model) return 'Model not configured';
  const shortName = model.split('/').pop()?.replace(/:free$/, '') ?? model;
  const labels: Record<string, string> = {
    'minimax-m3': 'MiniMax M3',
    'mimo-v2.5': 'MiMo V2.5',
    'muse-spark-1.2-contributor': 'Muse Spark 1.2 Contributor',
  };
  if (labels[shortName]) return labels[shortName];
  return shortName.replace(/[-_]/g, ' ');
}

/** Format a wake name for the player-facing card. */
function wakeLabel(wake: string): string {
  if (wake === 'strategic') return 'Strategy';
  if (wake === 'diplomacy') return 'Diplomacy';
  return 'Deal';
}

/** Format a canonical outcome without inventing a speech result. */
function outcomeLabel(outcome: string): string {
  if (outcome === 'pass' || outcome === 'keep-status-quo') return 'Passed';
  if (outcome === 'spoke') return 'Spoke';
  if (outcome === 'close') return 'Closed conversation';
  if (outcome === 'deal' || outcome === 'proposed' || outcome === 'accepted' || outcome === 'rejected') return 'Deal action';
  if (outcome === 'error') return 'Error';
  return outcome || 'Unknown';
}

/** Convert one server read-model entry to the compact card shape. */
function buildCard(source: CivilizationMindReadModel): MindCard {
  const active = source.activity.activeWakes;
  const last = source.recentWakes[source.recentWakes.length - 1];
  const architecture = source.architecture === 'unified-mind'
    ? 'Unified Civilization Mind'
    : source.architecture === 'human' ? 'Human strategist'
      : source.architecture === 'legacy' ? 'Legacy AI' : 'Native Civ / Vox Populi';
  return {
    source,
    playerId: String(source.playerId),
    civilization: source.civilization,
    leader: source.leader,
    architecture,
    model: friendlyModel(source.model),
    activity: active.length === 0 ? 'Idle' : `Reasoning · ${active.map(item => wakeLabel(item.wake)).join(' + ')}`,
    lastWake: last ? wakeLabel(last.wake) : 'None recorded',
    lastTurn: last?.turn === undefined ? 'Unknown' : String(last.turn),
    outcome: last ? outcomeLabel(last.outcome) : 'Unknown',
    timeline: source.recentWakes,
  };
}

/** Build cards directly from the backend-owned read model. */
const cards = computed(() => minds.value.map(buildCard));
/** Resolve the selected card for the compact inspector. */
const selectedCard = computed(() => cards.value.find(card => card.playerId === selectedPlayerId.value) ?? null);

/** Fetch the canonical read model, including active in-memory wakes. */
async function loadMinds(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.getCivilizationMinds();
    minds.value = response.minds;
    lastUpdated.value = new Date();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Failed to load civilization minds';
  } finally {
    loading.value = false;
  }
}

/** Close the inspector and return to the card collection. */
function closeInspector(): void { selectedPlayerId.value = null; }
/** Open the inspector for a selected seat. */
function openInspector(playerId: string): void { selectedPlayerId.value = playerId; }
/** Open the existing telemetry drill-down for the selected runtime context. */
function openTelemetry(card: MindCard): void {
  const contextId = card.source.runtimeContextId;
  if (!contextId) return;
  dialogVisible.value = false;
  router.push({ name: 'telemetry-session', params: { sessionId: contextId } });
}
/** Open Talk using the runtime context, even before the first wake has exported a span. */
function openTalk(card: MindCard): void {
  const contextId = card.source.runtimeContextId;
  if (!contextId) return;
  talkContextId.value = contextId;
  talkVisible.value = true;
}
/** Format the age of the last read-model refresh. */
function refreshAge(): string {
  if (!lastUpdated.value) return '';
  const seconds = Math.floor((Date.now() - lastUpdated.value.getTime()) / 1000);
  return seconds < 5 ? 'Just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}
/** Stop the dialog's refresh timer. */
function releasePolling(): void {
  if (pollInterval !== null) clearInterval(pollInterval);
  pollInterval = null;
}

watch(dialogVisible, visible => {
  if (visible) {
    void loadMinds();
    releasePolling();
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
      <div class="header-content"><div><h2>Civilization Minds</h2><p class="header-subtitle">One political mind can own strategy, diplomacy, and deals.</p></div><span v-if="lastUpdated" class="last-updated">{{ refreshAge() }}</span></div>
    </template>
    <div v-if="loading && cards.length === 0" class="loading-container"><ProgressSpinner /><p>Loading civilization minds...</p></div>
    <div v-else-if="error" class="error-container"><i class="pi pi-exclamation-triangle"></i><p>{{ error }}</p><Button label="Retry" @click="loadMinds" /></div>
    <div v-else-if="selectedCard" class="mind-inspector">
      <div class="inspector-heading"><Button label="Back to minds" icon="pi pi-arrow-left" severity="secondary" text @click="closeInspector" /><div><h3>{{ selectedCard.leader }} of {{ selectedCard.civilization }}</h3><p>{{ selectedCard.architecture }} · {{ selectedCard.model }}</p></div><Tag :value="selectedCard.activity" :severity="selectedCard.activity === 'Idle' ? 'secondary' : 'info'" /></div>
      <div class="inspector-facts"><div><span>Seat</span><strong>{{ selectedCard.playerId }}</strong></div><div><span>Last wake</span><strong>{{ selectedCard.lastWake }} · Turn {{ selectedCard.lastTurn }}</strong></div><div><span>Last outcome</span><strong>{{ selectedCard.outcome }}</strong></div><div><span>Score</span><strong>{{ selectedCard.source.game.score ?? 'Not available' }}</strong></div><div><span>Current research</span><strong>{{ selectedCard.source.game.currentResearch ?? 'Not available' }}</strong></div><div><span>Active agreements</span><strong>{{ selectedCard.source.game.activeAgreementCount }}</strong></div></div>
      <section class="inspector-section"><h4>Activity timeline</h4><div v-if="selectedCard.timeline.length === 0" class="empty-copy">No unified wake telemetry recorded yet.</div><div v-for="item in selectedCard.timeline" :key="item.spanId" class="timeline-item"><div class="timeline-main"><strong>{{ wakeLabel(item.wake) }}</strong><Tag :value="outcomeLabel(item.outcome)" severity="secondary" /><span>Turn {{ item.turn ?? 'unknown' }}</span></div><div class="timeline-meta">{{ formatTimestamp(item.timestamp) }} · {{ formatDuration(item.durationMs) }} · {{ friendlyModel(item.model) }}</div><div v-if="item.tokens.input !== undefined || item.tokens.output !== undefined" class="timeline-meta">Tokens: {{ formatTokenCount(item.tokens.input) }} in / {{ formatTokenCount(item.tokens.output) }} out</div><div class="timeline-meta">Trace {{ item.traceId }}</div></div></section>
      <details class="developer-details"><summary>Developer details</summary><p>Player: {{ selectedCard.source.playerId }}</p><p>Runtime context: {{ selectedCard.source.runtimeContextId ?? 'not available' }}</p><p>History is limited to completed wake spans.</p></details>
      <Button v-if="selectedCard.source.runtimeContextId" label="Open telemetry" icon="pi pi-chart-line" text @click="openTelemetry(selectedCard)" />
    </div>
    <div v-else class="mind-grid"><div v-if="cards.length === 0" class="table-empty"><i class="pi pi-inbox"></i><p>No civilization seats found.</p></div><article v-for="card in cards" :key="card.playerId" class="mind-card"><div class="card-heading"><div><h3>{{ card.civilization }}</h3><p>{{ card.leader }} · Seat {{ card.playerId }}</p></div><Tag :value="card.activity" :severity="card.activity === 'Idle' ? 'secondary' : 'info'" /></div><div class="architecture" :class="{ unified: card.source.architecture === 'unified-mind' }">{{ card.architecture }}</div><div class="card-fact"><span>Model</span><strong>{{ card.model }}</strong></div><div class="card-fact"><span>Last wake</span><strong>{{ card.lastWake }} · Turn {{ card.lastTurn }}</strong></div><div class="card-fact"><span>Outcome</span><strong>{{ card.outcome }}</strong></div><div class="card-actions"><Button label="Open Mind" size="small" outlined @click="openInspector(card.playerId)" /><Button v-if="card.source.architecture === 'unified-mind' && card.source.runtimeContextId" label="Talk" icon="pi pi-comments" size="small" @click="openTalk(card)" /><span v-else-if="card.source.architecture === 'unified-mind'" class="legacy-note">Runtime context not available yet</span><span v-else class="legacy-note">Legacy controls</span></div></article></div>
  </Dialog>
  <AgentSelectDialog v-model:visible="talkVisible" :context-id="talkContextId" initial-conversation-mode="diplomacy" />
</template>

<style scoped>
.header-content,.card-heading,.inspector-heading,.card-actions,.timeline-main{display:flex;align-items:center;gap:.6rem}.header-content{width:100%;align-items:flex-start}.header-content h2,.card-heading h3,.inspector-heading h3{margin:0}.header-subtitle,.card-heading p,.inspector-heading p{margin:.25rem 0 0;color:var(--p-text-secondary-color)}.last-updated{margin-left:auto;color:var(--p-text-secondary-color);font-size:.875rem}.mind-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.85rem}.mind-card{border:1px solid var(--p-content-border-color);border-radius:8px;padding:1rem;background:var(--p-content-background)}.card-heading{justify-content:space-between;align-items:flex-start}.architecture{margin:.8rem 0;color:var(--p-text-secondary-color)}.architecture.unified{color:var(--p-primary-color);font-weight:600}.card-fact,.inspector-facts div{display:flex;justify-content:space-between;gap:.5rem;margin:.45rem 0}.card-fact span,.inspector-facts span{color:var(--p-text-secondary-color)}.card-actions{margin-top:1rem;flex-wrap:wrap}.legacy-note,.empty-copy,.timeline-meta{color:var(--p-text-secondary-color);font-size:.875rem}.mind-inspector{display:flex;flex-direction:column;gap:1rem}.inspector-heading{align-items:flex-start}.inspector-heading .p-tag{margin-left:auto}.inspector-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.4rem .8rem}.inspector-section{border-top:1px solid var(--p-content-border-color);padding-top:.8rem}.inspector-section h4{margin:.1rem 0 .7rem}.timeline-item{border:1px solid var(--p-content-border-color);border-radius:6px;padding:.65rem;margin:.5rem 0}.timeline-main{flex-wrap:wrap}.developer-details{border-top:1px solid var(--p-content-border-color);padding-top:.8rem}.developer-details p{margin:.35rem 0}.loading-container,.error-container,.table-empty{text-align:center;padding:2rem}.error-container{color:var(--p-red-500)}
</style>
