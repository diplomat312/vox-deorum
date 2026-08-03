<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import type { MenuItem } from 'primevue/menuitem';
import SeatSummaryTable from './SeatSummaryTable.vue';
import type { AgentInfo, SessionConfigEntry, StrategistSessionConfig, VoxAgentsConfig } from '@/utils/types';
import { describeConfig, type WizardRole } from '@/utils/session-summary';

const props = defineProps<{
  configs: readonly SessionConfigEntry[];
  agents: readonly AgentInfo[];
  globalLlms: VoxAgentsConfig['llms'];
  loading: boolean;
  error: string | null;
  sessionActive: boolean;
  startingSession: boolean;
  highlightedConfigName: string | null;
}>();

const emit = defineEmits<{
  create: [];
  advancedCreate: [];
  start: [config: StrategistSessionConfig];
  edit: [config: StrategistSessionConfig];
  duplicate: [config: StrategistSessionConfig];
  delete: [config: SessionConfigEntry];
}>();

const searchInput = ref('');
const searchQuery = ref('');
const sortOrder = ref<'recent' | 'name'>('recent');
const expandedConfigNames = ref(new Set<string>());
const actionConfig = ref<SessionConfigEntry | null>(null);
const actionMenu = ref<{ toggle(event: Event): void } | null>(null);
const advancedMenu = ref<{ toggle(event: Event): void } | null>(null);
const visibleFileConfigName = ref<string | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const sortOptions: Array<{ label: string; value: 'recent' | 'name' }> = [
  { label: 'Recent', value: 'recent' },
  { label: 'Name', value: 'name' }
];

/** Recompute the filter after a short pause so typing does not rerender the full list on every keypress. */
function queueSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery.value = searchInput.value.trim().toLocaleLowerCase();
    searchTimer = null;
  }, 300);
}

watch(searchInput, queueSearch);

/** Create complete display summaries once for the active list inputs. */
const describedConfigs = computed(() => props.configs.map(config => ({
  config,
  summary: describeConfig(config, props.agents, props.globalLlms)
})));

/** Filter by player-facing name and description, then preserve the requested stable ordering. */
const visibleConfigs = computed(() => {
  const query = searchQuery.value;
  const configs = describedConfigs.value.filter(({ config }) => {
    if (!query) return true;
    return `${config.name} ${config.description ?? ''}`.toLocaleLowerCase().includes(query);
  });

  return [...configs].sort((left, right) => {
    if (sortOrder.value === 'name') return left.config.name.localeCompare(right.config.name);
    return right.config.updatedAt.localeCompare(left.config.updatedAt) || left.config.name.localeCompare(right.config.name);
  });
});

/** Toggle the detail panel for one configuration. */
function toggleExpanded(config: SessionConfigEntry): void {
  const names = new Set(expandedConfigNames.value);
  if (names.has(config.name)) names.delete(config.name);
  else names.add(config.name);
  expandedConfigNames.value = names;
}

/** Creates a stable whitespace-free DOM ID for a saved configuration's detail row. */
function detailsId(config: SessionConfigEntry): string {
  return `config-details-${encodeURIComponent(config.filename)}`;
}

/** Open the compact action menu for a selected configuration. */
function openActionMenu(event: Event, config: SessionConfigEntry): void {
  actionConfig.value = config;
  actionMenu.value?.toggle(event);
}

/** Open the advanced-editor menu without adding a second permanent toolbar button. */
function openAdvancedMenu(event: Event): void {
  advancedMenu.value?.toggle(event);
}

/** Run one overflow-menu action when a configuration is selected. */
function runAction(action: 'edit' | 'duplicate' | 'view' | 'delete'): void {
  const config = actionConfig.value;
  if (!config) return;
  if (action === 'view') {
    visibleFileConfigName.value = config.name;
    if (!expandedConfigNames.value.has(config.name)) toggleExpanded(config);
  }
  else if (action === 'edit') emit('edit', plainConfig(config));
  else if (action === 'duplicate') emit('duplicate', plainConfig(config));
  else emit('delete', config);
}

/** Build menu items after the selected configuration changes. */
const actionItems = computed<MenuItem[]>(() => [
  { label: 'Edit', icon: 'pi pi-pencil', command: () => runAction('edit') },
  { label: 'Duplicate', icon: 'pi pi-copy', command: () => runAction('duplicate') },
  { label: 'View file', icon: 'pi pi-code', command: () => runAction('view') },
  { separator: true },
  { label: 'Delete', icon: 'pi pi-trash', command: () => runAction('delete') }
]);

const advancedItems: MenuItem[] = [
  { label: 'New advanced configuration', icon: 'pi pi-plus', command: () => emit('advancedCreate') }
];

/** Make role values written for generation readable in the session table. */
function roleLabel(role: WizardRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Include a finite repetition count in the table's game-mode cell. */
function modeLabel(summary: ReturnType<typeof describeConfig>, config: SessionConfigEntry): string {
  const role = roleLabel(summary.role);
  return typeof config.repetition === 'number' && config.repetition > 1 ? `${role} ×${config.repetition}` : role;
}

/** Render file modification time without implying the configuration was played then. */
function updatedLabel(updatedAt: string): string {
  const updated = new Date(updatedAt);
  const elapsedMs = Date.now() - updated.getTime();
  if (Number.isNaN(elapsedMs) || elapsedMs < 0) return `Updated ${updatedAt}`;
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  if (elapsedDays === 0) return 'Updated today';
  if (elapsedDays === 1) return 'Updated yesterday';
  return `Updated ${elapsedDays} days ago`;
}

/** List configuration flags that affect a run without crowding the main table row. */
function configFlags(config: SessionConfigEntry): string[] {
  const flags: string[] = [];
  if (config.randomSeeds) flags.push('Fixed seeds');
  if (config.randomizeSeating) flags.push('Rotating seats');
  if (config.repetition) flags.push(`Repeats ${config.repetition}`);
  return flags;
}

/** Remove list-only transport metadata before passing a config to session actions. */
function plainConfig(config: SessionConfigEntry): StrategistSessionConfig {
  const { filename: _filename, updatedAt: _updatedAt, ...sessionConfig } = config;
  return sessionConfig;
}

/** Render the saved configuration shape only after the player explicitly asks for it. */
function configFile(config: SessionConfigEntry): string {
  return JSON.stringify(plainConfig(config), null, 2);
}

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="panel-container">
    <Toolbar>
      <template #start>
        <h3>Game Configurations</h3>
      </template>
      <template #end>
        <div class="flex gap-2">
          <Button
            icon="pi pi-plus"
            label="New Configuration"
            severity="success"
            size="small"
            @click="$emit('create')"
          />
          <Button
            icon="pi pi-angle-down"
            label="Advanced"
            severity="secondary"
            size="small"
            @click="openAdvancedMenu($event)"
          />
        </div>
      </template>
    </Toolbar>

    <div class="table-toolbar">
      <span class="p-input-icon-left">
        <i class="pi pi-search" />
        <InputText v-model="searchInput" placeholder="Search configurations" aria-label="Search configurations" />
      </span>
      <div class="table-sort-control">
        <label for="config-sort">Sort:</label>
        <Select id="config-sort" v-model="sortOrder" :options="sortOptions" optionLabel="label" optionValue="value" />
      </div>
    </div>

    <div v-if="loading" class="table-loading">
      <ProgressSpinner />
      <span class="ml-2">Loading configurations...</span>
    </div>

    <div v-else-if="error" class="p-3">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else-if="configs.length === 0" class="table-empty">
      <i class="pi pi-inbox"></i>
      <p>No game configurations yet</p>
      <Button label="Set up a game" icon="pi pi-plus" @click="$emit('create')" />
    </div>

    <div v-else class="table-scroll">
      <div class="data-table" role="table" aria-label="Game configurations">
        <div class="table-header" role="row">
          <div class="col-fixed-40" role="columnheader" aria-label="Details" />
          <div class="col-expand" role="columnheader">Name</div>
          <div class="col-fixed-80" role="columnheader">Mode</div>
          <div class="col-fixed-60" role="columnheader">Civs</div>
          <div class="col-fixed-100" role="columnheader">Map</div>
          <div class="col-fixed-150" role="columnheader">Agentic AI</div>
          <div class="col-fixed-80" role="columnheader">Pace</div>
          <div class="col-fixed-80" role="columnheader">Actions</div>
        </div>

        <div class="table-body" role="rowgroup">
          <template v-for="{ config, summary } in visibleConfigs" :key="config.filename">
            <div :class="['table-row', { selected: config.name === highlightedConfigName }]" role="row">
              <div class="col-fixed-40" role="cell">
                <Button
                  :icon="expandedConfigNames.has(config.name) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                  text
                  rounded
                  size="small"
                  :aria-controls="detailsId(config)"
                  :aria-expanded="expandedConfigNames.has(config.name)"
                  :aria-label="`${expandedConfigNames.has(config.name) ? 'Hide' : 'Show'} details for ${config.name}`"
                  @click="toggleExpanded(config)"
                />
              </div>
              <div class="col-expand text-truncate" role="cell">{{ config.name }}</div>
              <div class="col-fixed-80" role="cell"><Tag :value="modeLabel(summary, config)" severity="info" /></div>
              <div class="col-fixed-60" role="cell">{{ summary.civCount }}</div>
              <div class="col-fixed-100" role="cell">{{ summary.mapSize }}</div>
              <div class="col-fixed-150 text-truncate" role="cell">{{ summary.styleLabel }}</div>
              <div class="col-fixed-80" role="cell" v-tooltip="summary.paceTooltip">{{ summary.paceLabel }}</div>
              <div class="col-fixed-80" role="cell">
                <div class="flex gap-1">
                  <Button
                    icon="pi pi-play"
                    severity="success"
                    size="small"
                    rounded
                    v-tooltip="'Start Session'"
                    :disabled="sessionActive || startingSession"
                    :loading="startingSession"
                    aria-label="Start session"
                    @click="$emit('start', plainConfig(config))"
                  />
                  <Button
                    icon="pi pi-ellipsis-v"
                    severity="secondary"
                    size="small"
                    rounded
                    v-tooltip="'Configuration actions'"
                    aria-label="Configuration actions"
                    @click="openActionMenu($event, config)"
                  />
                </div>
              </div>
            </div>

            <div v-if="expandedConfigNames.has(config.name)" :id="detailsId(config)" class="table-expander-row" role="row">
              <div class="table-expander-content" role="cell" aria-colspan="8">
                <p>{{ config.description || summary.sentence }}</p>
                <SeatSummaryTable :seat-rows="summary.seatRows" :ariaLabel="`Seats in ${config.name}`" />
                <p class="text-small text-muted">{{ [...configFlags(config), updatedLabel(config.updatedAt)].join(' · ') }}</p>
                <details v-if="visibleFileConfigName === config.name" class="table-config-file" open>
                  <summary>Configuration file</summary>
                  <pre>{{ configFile(config) }}</pre>
                </details>
              </div>
            </div>
          </template>
          <div v-if="visibleConfigs.length === 0" class="table-empty">
            <i class="pi pi-search" />
            <p>No configurations match that search</p>
          </div>
        </div>
      </div>
    </div>
    <Menu ref="actionMenu" :model="actionItems" popup />
    <Menu ref="advancedMenu" :model="advancedItems" popup />
  </div>
</template>
