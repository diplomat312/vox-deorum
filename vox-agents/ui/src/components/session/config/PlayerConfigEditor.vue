<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dropdown from 'primevue/dropdown';
import InputNumber from 'primevue/inputnumber';
import type { PacingInterruption, PlayerConfig, SelectOption } from '@/utils/types';

type PlayerListEntry = { id: number; player: PlayerConfig };

const props = defineProps<{
  players: Record<number, PlayerConfig>;
  autoPlay: boolean;
  strategistOptions: SelectOption<string>[];
  modelOptions: SelectOption<string>[];
  interruptionOptions: SelectOption<PacingInterruption>[];
  loadingStrategists: boolean;
  loadingModels: boolean;
  loadingInterruptions: boolean;
}>();

const emit = defineEmits<{
  'update:players': [value: Record<number, PlayerConfig>];
}>();

const selectedPlayerId = ref<number | null>(null);
const sortedPlayerIds = computed(() => Object.keys(props.players).map(Number).sort((a, b) => a - b));
const playerListEntries = computed<PlayerListEntry[]>(() => sortedPlayerIds.value
  .map(id => ({ id, player: props.players[id]! })));
const selectedPlayer = computed(() => selectedPlayerId.value === null ? null : props.players[selectedPlayerId.value] ?? null);
const selectedPlayerTitle = computed(() => selectedPlayerId.value === null ? 'No Player Selected' : `Player ${selectedPlayerId.value}`);
const architectureOptions: SelectOption<'unified' | 'legacy'>[] = [
  { label: 'Unified Civilization Mind', value: 'unified', description: 'One model governs strategy, diplomacy, and deals.' },
  { label: 'Legacy Agent Architecture', value: 'legacy', description: 'Use the existing strategist and diplomacy agents.' },
];
const selectedIsUnified = computed(() => selectedPlayer.value?.mind === 'unified-mind');
const selectedModel = computed(() => {
  const model = selectedPlayer.value?.llms?.['unified-mind'];
  if (typeof model === 'string') return model;
  return model ? `${model.provider}/${model.name}` : '';
});
const selectedModelOptions = computed(() => {
  const options = [...props.modelOptions];
  if (selectedModel.value && !options.some(option => option.value === selectedModel.value)) {
    options.unshift({ label: selectedModel.value, value: selectedModel.value, description: 'Saved model' });
  }
  return options;
});

/** Keep selection valid when the parent replaces the player collection. */
watch(() => props.players, () => {
  if (selectedPlayerId.value === null || !props.players[selectedPlayerId.value]) selectFirstPlayer();
}, { immediate: true });

/** Shift the observer seat between player zero and player one when observation mode changes. */
watch(() => props.autoPlay, (newValue, oldValue) => {
  if (newValue === oldValue) return;
  const ids = sortedPlayerIds.value;
  // ConfigDialog owns default creation when it resets the form for add mode.
  // An empty map therefore needs no seat migration here.
  if (ids.length === 0) return;
  if (!newValue && ids.includes(0)) shiftPlayerId(0, 1);
  else if (newValue && ids[0] === 1 && !ids.includes(0)) shiftPlayerId(1, 0);
});

/** Add a player using the next valid seat and select it. */
function addPlayer(): void {
  const startingId = props.autoPlay ? -1 : 0;
  const nextId = Math.max(startingId, ...Object.keys(props.players).map(Number)) + 1;
  const players = { ...props.players };
  players[nextId] = {
    strategist: props.strategistOptions[0]?.value || 'simple-strategist',
    pacing: { everyTurns: 1, interruption: 'none' },
    llms: {}
  };
  emit('update:players', players);
  selectedPlayerId.value = nextId;
}

/** Remove a player and select the first remaining seat when needed. */
function removePlayer(playerId: number): void {
  const players = { ...props.players };
  delete players[playerId];
  emit('update:players', players);
  if (selectedPlayerId.value === playerId) {
    selectedPlayerId.value = Object.keys(players).map(Number).sort((a, b) => a - b)[0] ?? null;
  }
}

/** Select a player for detail editing. */
function selectPlayer(playerId: number): void {
  selectedPlayerId.value = playerId;
}

/** Select the first configured player, or clear selection when none remain. */
function selectFirstPlayer(): void {
  selectedPlayerId.value = sortedPlayerIds.value[0] ?? null;
}

/** Move a configured player to a new seat while preserving the remaining map. */
function shiftPlayerId(from: number, to: number): void {
  const players: Record<number, PlayerConfig> = {};
  for (const [id, player] of Object.entries(props.players)) players[Number(id) === from ? to : Number(id)] = player;
  emit('update:players', players);
  if (selectedPlayerId.value === from) selectedPlayerId.value = to;
}

/** Replace one selected-player field without mutating props. */
function updateSelectedPlayer(patch: Partial<PlayerConfig>): void {
  const id = selectedPlayerId.value;
  const player = selectedPlayer.value;
  if (id === null || !player) return;
  emit('update:players', { ...props.players, [id]: { ...player, ...patch } });
}

/** Update the selected strategist. */
function updateStrategist(value: string | null): void {
  updateSelectedPlayer({ strategist: value ?? '' });
}

/** Switch the selected seat between the player-level architectures. */
function updateArchitecture(value: 'unified' | 'legacy' | null): void {
  const player = selectedPlayer.value;
  if (!player || !value) return;
  if (value === 'unified') {
    const model = selectedModel.value || props.modelOptions[0]?.value || '';
    updateSelectedPlayer({
      strategist: 'simple-strategist',
      mind: 'unified-mind',
      llms: { ...(player.llms ?? {}), 'unified-mind': model },
    });
    return;
  }
  const next: PlayerConfig = { ...player };
  delete next.mind;
  if (next.strategist === 'simple-strategist' && props.strategistOptions[0]?.value) {
    next.strategist = props.strategistOptions[0].value;
  }
  if (next.llms) {
    const llms = { ...next.llms };
    delete llms['unified-mind'];
    next.llms = Object.keys(llms).length > 0 ? llms : undefined;
  }
  emit('update:players', { ...props.players, [selectedPlayerId.value!]: next });
}

/** Update the unified model while preserving unrelated seat model aliases. */
function updateUnifiedModel(value: string | null): void {
  const player = selectedPlayer.value;
  if (!player || !value) return;
  updateSelectedPlayer({ llms: { ...(player.llms ?? {}), 'unified-mind': value } });
}

/** Update the selected pacing cadence. */
function updateEveryTurns(value: number | null): void {
  const player = selectedPlayer.value;
  if (!player) return;
  updateSelectedPlayer({ pacing: { ...player.pacing, everyTurns: value ?? 1 } });
}

/** Update the selected pacing interruption. */
function updateInterruption(value: PacingInterruption | null): void {
  const player = selectedPlayer.value;
  if (!player) return;
  updateSelectedPlayer({ pacing: { ...player.pacing, interruption: value ?? 'none' } });
}

/** Return the display label for a strategist value. */
function strategistLabel(value: string): string {
  return props.strategistOptions.find(option => option.value === value)?.label || value || 'No strategist';
}

/** Return the player-facing architecture label for a seat. */
function architectureLabel(player: PlayerConfig): string {
  return player.mind === 'unified-mind' ? 'Unified Civilization Mind' : strategistLabel(player.strategist);
}

/** Resolve a saved unified model reference for the compact player list. */
function selectedModelFor(player: PlayerConfig): string {
  const model = player.llms?.['unified-mind'];
  return typeof model === 'string' ? model : model ? `${model.provider}/${model.name}` : '';
}

/** Return a compact pacing summary for the player list. */
function pacingSummary(player: PlayerConfig): string {
  const everyTurns = player.pacing?.everyTurns ?? 1;
  const interruption = player.pacing?.interruption ?? 'none';
  const label = props.interruptionOptions.find(option => option.value === interruption)?.label || interruption;
  return interruption === 'none' ? `Every ${everyTurns} turn${everyTurns === 1 ? '' : 's'}` : `Every ${everyTurns}, ${label}`;
}

</script>

<template>
  <Card class="config-section">
    <template #title>
      <i class="pi pi-users" /> LLM Players
      <Button label="Add Player" icon="pi pi-plus" text size="small" style="margin-left: auto" @click="addPlayer" />
    </template>
    <template #content>
      <div v-if="Object.keys(players).length === 0" class="empty-state">
        <i class="pi pi-user-plus" />
        <p>No players configured. Click "Add Player" to add one.</p>
      </div>
      <div v-else class="player-master-detail">
        <div class="player-list" role="listbox" aria-label="LLM players">
          <div v-for="entry in playerListEntries" :key="entry.id" class="player-list-item"
            :class="{ active: selectedPlayerId === entry.id }" role="option" tabindex="0"
            :aria-selected="selectedPlayerId === entry.id" @click="selectPlayer(entry.id)"
            @keydown.enter="selectPlayer(entry.id)" @keydown.space.prevent="selectPlayer(entry.id)">
            <span class="player-row-main">
              <span class="player-label">Player {{ entry.id }}</span>
              <Button icon="pi pi-trash" severity="danger" text rounded size="small" v-tooltip="'Remove player'" @click.stop="removePlayer(entry.id)" />
            </span>
            <span class="player-strategist text-truncate">{{ architectureLabel(entry.player) }}</span>
            <span v-if="entry.player.mind === 'unified-mind'" class="player-model text-truncate">{{ selectedModelFor(entry.player) || 'Model not configured' }}</span>
            <span class="player-pacing">{{ pacingSummary(entry.player) }}</span>
          </div>
        </div>

        <div v-if="selectedPlayer && selectedPlayer.pacing" class="player-detail">
          <div class="player-detail-header"><h4>{{ selectedPlayerTitle }}</h4></div>
          <div class="detail-field">
            <label :for="`architecture-${selectedPlayerId}`">Architecture</label>
            <Dropdown :id="`architecture-${selectedPlayerId}`" :modelValue="selectedIsUnified ? 'unified' : 'legacy'"
              :options="architectureOptions" optionLabel="label" optionValue="value" class="detail-input"
              @update:modelValue="updateArchitecture">
              <template #option="{ option }">
                <div class="dropdown-option"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></div>
              </template>
            </Dropdown>
          </div>
          <div v-if="selectedIsUnified" class="detail-field">
            <label :for="`unified-model-${selectedPlayerId}`">Civilization model</label>
            <Dropdown :id="`unified-model-${selectedPlayerId}`" :modelValue="selectedModel" :options="selectedModelOptions"
              optionLabel="label" optionValue="value" placeholder="Select a model" :loading="loadingModels"
              class="detail-input" @update:modelValue="updateUnifiedModel">
              <template #option="{ option }">
                <div class="dropdown-option"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></div>
              </template>
            </Dropdown>
            <small v-if="!selectedModel" class="detail-error">Choose a model before saving this unified seat.</small>
          </div>
          <div v-else class="detail-field">
            <label :for="`strategist-${selectedPlayerId}`">Strategist</label>
            <Dropdown :id="`strategist-${selectedPlayerId}`" :modelValue="selectedPlayer.strategist"
              :options="strategistOptions" optionLabel="label" optionValue="value" placeholder="Select strategist"
              :loading="loadingStrategists" class="detail-input" @update:modelValue="updateStrategist">
              <template #option="{ option }">
                <div class="dropdown-option"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></div>
              </template>
            </Dropdown>
          </div>
          <div class="detail-grid">
            <div class="detail-field cadence-field">
              <label :for="`pacing-turns-${selectedPlayerId}`">Every turns</label>
              <InputNumber :id="`pacing-turns-${selectedPlayerId}`" :modelValue="selectedPlayer.pacing.everyTurns"
                :min="1" :max="100" showButtons class="detail-input cadence-input" @update:modelValue="updateEveryTurns" />
            </div>
            <div class="detail-field">
              <label :for="`pacing-interruption-${selectedPlayerId}`">Interruption</label>
              <Dropdown :id="`pacing-interruption-${selectedPlayerId}`" :modelValue="selectedPlayer.pacing.interruption"
                :options="interruptionOptions" optionLabel="label" optionValue="value" :loading="loadingInterruptions"
                class="detail-input" @update:modelValue="updateInterruption">
                <template #option="{ option }">
                  <div class="dropdown-option"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></div>
                </template>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.player-master-detail { display: grid; gap: 0.75rem; grid-template-columns: minmax(16rem, 0.9fr) minmax(20rem, 1.4fr); }
.player-list { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
.player-list-item { background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 6px; color: var(--p-text-color); cursor: pointer; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.6rem 0.7rem; text-align: left; transition: background 0.2s, border-color 0.2s; width: 100%; }
.player-list-item:hover, .player-list-item.active { background: var(--p-content-hover-background); border-color: var(--p-primary-color); }
.player-row-main { align-items: center; display: flex; gap: 0.5rem; justify-content: space-between; }
.player-strategist { color: var(--p-text-color); font-weight: 500; }
.player-pacing { color: var(--p-text-muted-color); font-size: 0.875rem; }
.player-model { color: var(--p-text-muted-color); font-size: 0.8rem; }
.player-detail { border: 1px solid var(--p-content-border-color); border-radius: 6px; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; padding: 0.85rem; }
.player-detail-header h4 { font-size: 1rem; margin: 0; }
.detail-grid { align-items: end; display: grid; gap: 0.75rem; grid-template-columns: 7.5rem minmax(12rem, 1fr); }
.detail-field { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
.detail-field label { color: var(--p-text-color); font-weight: 500; }
.detail-input { width: 100%; }
.cadence-field, .cadence-input { max-width: 7.5rem; }
.cadence-input :deep(.p-inputnumber-input) { width: 4rem; }
.dropdown-option { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.dropdown-option small { color: var(--p-text-muted-color); white-space: normal; }
.detail-error { color: var(--p-red-700); }

@media (max-width: 760px) {
  .player-master-detail, .detail-grid { grid-template-columns: 1fr; }
}
</style>
