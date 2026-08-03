<script setup lang="ts">
/** Guided game configuration wizard. */

import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import ProgressSpinner from 'primevue/progressspinner';
import Select from 'primevue/select';
import Slider from 'primevue/slider';
import { api } from '@/api/client';
import type { LLMConfig, StrategistSessionConfig } from '@/utils/types';
import { buildSeats, describeConfig, type SetupAgent, type WizardAnswers, type WizardRole } from '@/utils/session-summary';

/** Props supplied by the session view's shared catalogue state. */
interface Props {
  visible: boolean;
  agents: readonly SetupAgent[];
  agentsLoading: boolean;
  agentsError: string | null;
  globalLlms: Record<string, LLMConfig | string>;
}

/** Events emitted after saving or closing the wizard. */
interface Emits {
  (event: 'update:visible', value: boolean): void;
  (event: 'saved', config: StrategistSessionConfig, play: boolean): void;
  (event: 'retryAgents'): void;
  (event: 'advanced'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const step = ref(1);
const role = ref<WizardRole>('play');
const civCount = ref(8);
const agenticCount = ref(3);
const strategist = ref('');
const everyTurns = ref(5);
const interruption = ref('none');
const defaultInterruption = ref('none');
const modelId = ref('');
const name = ref('my-first-game');
const description = ref('');
const interruptions = ref<Array<{ label: string; value: string }>>([{ label: 'None', value: 'none' }]);
const models = ref<Array<{ id: string; name: string; provider: string }>>([]);
const defaultModel = ref<{ id: string; name: string; provider: string } | undefined>();
const loadingPacing = ref(false);
const loadingModels = ref(false);
const pacingLoaded = ref(false);
const modelsLoaded = ref(false);
const pacingError = ref('');
const modelsError = ref('');
const saving = ref(false);
const saveError = ref('');

/** Lists the registry-owned styles that opted into the game wizard. */
const offeredStrategists = computed(() => props.agents.filter(agent => agent.offeredInSetup));

/** Reports whether either remote choice source is currently loading. */
const loadingChoices = computed(() => loadingPacing.value || loadingModels.value);

const roleOptions: Array<{ value: WizardRole; label: string; description: string; badge?: string }> = [
  { value: 'play', label: 'Play the game yourself', description: 'You take one civilization. Agentic AI runs the rivals.', badge: 'Recommended' },
  { value: 'watch', label: 'Watch AI self-play', description: 'The game plays itself with agentic AI and Vox Populi AI.' },
  { value: 'direct', label: 'Direct a civilization like an agent', description: 'You set the strategy each decision turn while Civ V handles units and cities.', badge: 'Advanced' },
];

/** Ensures a role's agentic count leaves its protected human seat intact. */
const maxAgenticCount = computed(() => role.value === 'play' || role.value === 'direct' ? civCount.value - 1 : civCount.value);

/** Provides select options in the registry's stable order. */
const strategistOptions = computed(() => offeredStrategists.value.map(agent => ({
  label: agent.displayName ?? agent.name,
  value: agent.name,
})));

/** Finds the current global default label without exposing configuration options. */
function globalDefaultLabel(): string {
  const visited = new Set<string>();
  let reference = 'default';
  while (!visited.has(reference)) {
    visited.add(reference);
    const definition = props.globalLlms[reference];
    if (definition === undefined) return 'unavailable';
    if (typeof definition !== 'string') return definition.name;
    reference = definition;
  }
  return 'unavailable';
}

/** Provides provider-grouped catalogue options with a pinned no-override default. */
const modelOptions = computed(() => {
  const grouped = new Map<string, Array<{ label: string; value: string }>>();
  for (const model of models.value) {
    const options = grouped.get(model.provider) ?? [];
    options.push({ label: model.name, value: model.id });
    grouped.set(model.provider, options);
  }
  const defaultName = defaultModel.value?.name ?? globalDefaultLabel();
  return [
    { label: 'My default', items: [{ label: `My default, ${defaultName}`, value: '' }] },
    ...[...grouped.entries()].map(([provider, items]) => ({ label: provider, items })),
  ];
});

/** Shows the active strategist's registry-owned description beside its selector. */
const selectedStrategist = computed(() => offeredStrategists.value.find(agent => agent.name === strategist.value));

/** Estimates full-game strategy decisions from a standard 300-turn game. */
const decisionEstimate = computed(() => Math.ceil(300 / Math.max(1, everyTurns.value)) * agenticCount.value);

/** Builds the pure answer object shared by config generation and confirmation. */
function answers(): WizardAnswers {
  return {
    role: role.value,
    civCount: civCount.value,
    agenticCount: agenticCount.value,
    strategist: strategist.value,
    pacing: { everyTurns: everyTurns.value, interruption: interruption.value },
    ...(modelId.value ? { modelId: modelId.value } : {}),
    name: name.value.trim(),
    description: description.value.trim(),
  };
}

/** Generates the config that the existing session routes persist and launch. */
function generatedConfig(): StrategistSessionConfig {
  const current = answers();
  return {
    name: current.name || 'my-game',
    type: 'strategist',
    autoPlay: current.role !== 'play',
    llmPlayers: buildSeats(current),
    ...(current.description ? { description: current.description } : {}),
  };
}

/** Shows the shared pure summary of the config about to be saved. */
const summary = computed(() => describeConfig(generatedConfig(), props.agents, props.globalLlms));

/** Renders the exact generated configuration only when the player asks to inspect it. */
const generatedConfigJson = computed(() => JSON.stringify(generatedConfig(), null, 2));

/** Resets wizard state when the dialog is opened for another game. */
function reset(): void {
  step.value = 1;
  role.value = 'play';
  civCount.value = 8;
  agenticCount.value = 3;
  strategist.value = offeredStrategists.value[0]?.name ?? '';
  everyTurns.value = 5;
  interruption.value = defaultInterruption.value;
  modelId.value = '';
  name.value = 'my-first-game';
  description.value = '';
  saveError.value = '';
}

/** Converts the server's safe filename back to the config name used by the session list. */
function configNameFromFilename(filename: string): string {
  return filename.endsWith('.json') ? filename.slice(0, -'.json'.length) : filename;
}

/** Loads pacing choices independently so a model-catalogue failure cannot discard them. */
async function loadPacingChoices(): Promise<void> {
  if (loadingPacing.value || pacingLoaded.value) return;
  loadingPacing.value = true;
  pacingError.value = '';
  try {
    const pacingResponse = await api.getPacingInterruptions();
    interruptions.value = pacingResponse.interruptions.map(entry => ({ label: entry.label, value: entry.name }));
    const important = pacingResponse.interruptions.find(entry => entry.name === 'importantEvents');
    defaultInterruption.value = important?.name ?? 'none';
    interruption.value = defaultInterruption.value;
    pacingLoaded.value = true;
  } catch (caught) {
    pacingError.value = caught instanceof Error ? caught.message : 'Could not load pacing choices.';
  } finally {
    loadingPacing.value = false;
  }
}

/** Loads model choices independently so a pacing-registry failure cannot discard them. */
async function loadModelChoices(force = false): Promise<void> {
  if (loadingModels.value || (modelsLoaded.value && !force)) return;
  loadingModels.value = true;
  modelsError.value = '';
  try {
    const catalogue = await api.getConfigModels();
    defaultModel.value = catalogue.defaultModel;
    models.value = catalogue.models;
    modelsError.value = catalogue.failures.length > 0
      ? `Some providers could not be reached: ${catalogue.failures.join(' ')}`
      : '';
    modelsLoaded.value = true;
  } catch (caught) {
    modelsError.value = caught instanceof Error ? caught.message : 'Could not load the available models.';
  } finally {
    loadingModels.value = false;
  }
}

/** Starts both independent choice requests when the minds step becomes visible. */
async function loadMindChoices(): Promise<void> {
  await Promise.all([loadPacingChoices(), loadModelChoices()]);
}

/** Moves to a wizard step, loading remote choices only when they become relevant. */
async function goTo(nextStep: number): Promise<void> {
  step.value = nextStep;
  if (nextStep === 3) await loadMindChoices();
}

/** Closes the wizard without writing a configuration. */
function close(): void {
  if (!saving.value) emit('update:visible', false);
}

/** Persists the generated config, then tells the host whether to open launch mode selection. */
async function save(play: boolean): Promise<void> {
  if (!name.value.trim()) return;
  saving.value = true;
  saveError.value = '';
  const config = generatedConfig();
  try {
    const result = await api.saveSessionConfig(config.name, config);
    config.name = configNameFromFilename(result.filename);
    emit('saved', config, play);
    emit('update:visible', false);
  } catch (caught) {
    saveError.value = caught instanceof Error ? caught.message : 'The configuration could not be saved.';
  } finally {
    saving.value = false;
  }
}

watch(() => props.visible, visible => {
  if (visible) reset();
});

watch([role, civCount], () => {
  agenticCount.value = Math.min(agenticCount.value, maxAgenticCount.value);
});

watch(offeredStrategists, options => {
  if (!options.some(agent => agent.name === strategist.value)) strategist.value = options[0]?.name ?? '';
}, { immediate: true });
</script>

<template>
  <Dialog :visible="visible" modal class="setup-wizard-dialog" @update:visible="close">
    <template #header>
      <span>Set up a game</span>
    </template>

    <div class="setup-wizard-progress">
      <span :aria-current="step === 1 ? 'step' : undefined">1. Your role</span>
      <span :aria-current="step === 2 ? 'step' : undefined">2. The world</span>
      <span :aria-current="step === 3 ? 'step' : undefined">3. The minds</span>
      <span :aria-current="step === 4 ? 'step' : undefined">4. Confirm</span>
    </div>

    <section v-if="step === 1" class="setup-wizard-step">
      <div class="setup-wizard-heading"><h2>How do you want to play?</h2><p>Vox Deorum can run rivals, the whole game, or your strategic decisions.</p></div>
      <fieldset class="setup-wizard-choices border-none p-0 m-0">
        <legend>Choose your role</legend>
        <label v-for="choice in roleOptions" :key="choice.value" class="setup-wizard-choice">
          <input v-model="role" name="wizard-role" type="radio" :value="choice.value">
          <span><strong>{{ choice.label }}</strong><small>{{ choice.description }}</small><small v-if="choice.badge">{{ choice.badge }}</small></span>
        </label>
      </fieldset>
    </section>

    <section v-else-if="step === 2" class="setup-wizard-step">
      <div class="setup-wizard-heading"><h2>Who is in the game?</h2><p>{{ civCount }} civilizations on a {{ summary.mapSize }} map.</p></div>
      <div class="setup-wizard-field"><label for="wizard-civs">Civilizations in the game: {{ civCount }}</label><Slider id="wizard-civs" v-model="civCount" :min="2" :max="12" :step="2" /></div>
      <div class="setup-wizard-field"><label for="wizard-agentic">How many are agentic AI?</label><InputNumber id="wizard-agentic" v-model="agenticCount" :min="1" :max="maxAgenticCount" /></div>
      <div class="setup-wizard-summary">
        <p>{{ summary.sentence }}</p>
        <div class="table-seat-summary-scroll">
          <div class="table-seat-summary" role="table" aria-label="Game seats">
            <div class="table-seat-summary-header" role="row"><span role="columnheader">Seat</span><span role="columnheader">Plays as</span><span role="columnheader">Style</span><span role="columnheader">Thinks with</span></div>
            <div v-for="seatRow in summary.seatRows" :key="seatRow.seats" class="table-seat-summary-row" role="row"><span role="cell">{{ seatRow.seats }}</span><span role="cell">{{ seatRow.role }}</span><span role="cell">{{ seatRow.style }}</span><span role="cell">{{ seatRow.model }}</span></div>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="step === 3" class="setup-wizard-step">
      <div class="setup-wizard-heading"><h2>How do the agentic AI civilizations think?</h2></div>
      <div v-if="!strategist" class="setup-wizard-error-panel" role="status">
        <p v-if="agentsLoading">Loading game setup styles...</p>
        <template v-else-if="agentsError">
          <strong>Game setup styles could not be loaded.</strong>
          <p>{{ agentsError }}</p>
          <div class="setup-wizard-inline-actions">
            <Button label="Retry styles" severity="secondary" @click="$emit('retryAgents')" />
            <Button label="Open Advanced Configuration" @click="$emit('advanced')" />
          </div>
        </template>
        <template v-else>
          <strong>No game setup styles are available.</strong>
          <p>Use the advanced editor to create a configuration while styles are unavailable.</p>
          <Button label="Open Advanced Configuration" @click="$emit('advanced')" />
        </template>
      </div>
      <template v-else>
        <div class="setup-wizard-field"><label for="wizard-style">Style</label><Select id="wizard-style" v-model="strategist" :options="strategistOptions" option-label="label" option-value="value" /></div>
        <p v-if="selectedStrategist" class="text-muted text-small">{{ selectedStrategist.description }}</p>
        <div class="setup-wizard-field"><label for="wizard-pace">Re-think every turns</label><InputNumber id="wizard-pace" v-model="everyTurns" :min="1" /></div>
        <div class="setup-wizard-field"><label for="wizard-interruption">React to</label><Select id="wizard-interruption" v-model="interruption" :options="interruptions" option-label="label" option-value="value" /></div>
        <div class="setup-wizard-field"><label for="wizard-model">Model</label><Select id="wizard-model" v-model="modelId" :options="modelOptions" option-group-label="label" option-group-children="items" option-label="label" option-value="value" /></div>
        <div class="setup-wizard-summary"><p>{{ agenticCount }} agentic AI civilizations deciding every {{ everyTurns }} turns is roughly {{ decisionEstimate }} decisions across a full game, plus conversation replies.</p></div>
        <ProgressSpinner v-if="loadingChoices" class="setup-wizard-spinner" />
        <div v-if="pacingError" class="setup-wizard-error-panel" role="status">
          <strong>Pacing choices could not be loaded.</strong>
          <p>{{ pacingError }} The game will use None unless you retry.</p>
          <Button label="Retry pacing choices" severity="secondary" @click="loadPacingChoices" />
        </div>
        <div v-if="modelsError" class="setup-wizard-error-panel" role="status">
          <strong>{{ models.length > 0 ? 'Some model providers could not be reached.' : 'Model choices could not be loaded.' }}</strong>
          <p>{{ modelsError }} My default remains available.</p>
          <Button label="Retry model choices" severity="secondary" @click="loadModelChoices(true)" />
        </div>
      </template>
    </section>

    <section v-else class="setup-wizard-step">
      <div class="setup-wizard-heading"><h2>Confirm your game</h2></div>
      <div class="setup-wizard-field"><label for="wizard-name">Name</label><InputText id="wizard-name" v-model="name" /></div>
      <div class="setup-wizard-field"><label for="wizard-description">Description</label><InputText id="wizard-description" v-model="description" /></div>
      <div class="setup-wizard-summary">
        <p>{{ summary.sentence }}</p><p>{{ summary.styleLabel }}. {{ summary.paceTooltip }}.</p>
        <div class="table-seat-summary-scroll">
          <div class="table-seat-summary" role="table" aria-label="Game seats">
            <div class="table-seat-summary-header" role="row"><span role="columnheader">Seat</span><span role="columnheader">Plays as</span><span role="columnheader">Style</span><span role="columnheader">Thinks with</span></div>
            <div v-for="seatRow in summary.seatRows" :key="seatRow.seats" class="table-seat-summary-row" role="row"><span role="cell">{{ seatRow.seats }}</span><span role="cell">{{ seatRow.role }}</span><span role="cell">{{ seatRow.style }}</span><span role="cell">{{ seatRow.model }}</span></div>
          </div>
        </div>
        <details class="table-config-file"><summary>View file</summary><pre>{{ generatedConfigJson }}</pre></details>
      </div>
      <p v-if="saveError" class="setup-wizard-error">{{ saveError }}</p>
    </section>

    <template #footer>
      <div class="setup-wizard-footer">
        <Button label="Cancel" severity="secondary" :disabled="saving" @click="close" />
        <div class="setup-wizard-footer-next">
          <Button v-if="step > 1" label="Back" severity="secondary" :disabled="saving" @click="goTo(step - 1)" />
          <Button v-if="step < 4" label="Next" :disabled="step === 3 && !strategist" @click="goTo(step + 1)" />
          <Button v-else label="Save only" severity="secondary" :disabled="saving || !name.trim()" @click="save(false)" />
          <Button v-if="step === 4" label="Save & Play" :loading="saving" :disabled="!name.trim()" @click="save(true)" />
        </div>
      </div>
    </template>
  </Dialog>
</template>
