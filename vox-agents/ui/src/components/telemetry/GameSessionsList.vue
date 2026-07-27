<script setup lang="ts">
import Button from 'primevue/button';
import SessionListPanel from '../shared/SessionListPanel.vue';
import type { TelemetrySession } from '@/utils/types';

/**
 * Props for the GameSessionsList component
 */
interface Props {
  sessions: TelemetrySession[];
  title?: string;
  emptyMessage?: string;
  showViewButton?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Active Games',
  emptyMessage: 'No active game sessions available',
  showViewButton: true
});

/**
 * Emit events for session selection
 */
const emit = defineEmits<{
  'session-selected': [sessionId: string];
}>();

</script>

<template>
  <SessionListPanel
    :title="title"
    :count="sessions.length"
    :empty-message="emptyMessage"
    empty-icon="pi pi-info-circle"
    count-severity="success"
  >
    <template #empty-action>
      <slot name="empty-action"></slot>
    </template>
    <template #header>
        <div class="col-expand">Game ID</div>
        <div class="col-fixed-80">Player</div>
        <div v-if="showViewButton" class="col-fixed-100">Actions</div>
    </template>

    <div v-for="session in sessions" :key="session.sessionId"
         class="table-row clickable"
         @click="emit('session-selected', session.sessionId)">
      <div class="col-expand">
        {{ session.gameID || '-' }}
      </div>
      <div class="col-fixed-80">
        {{ session.playerID || '-' }}
      </div>
      <div v-if="showViewButton" class="col-fixed-100">
        <Button label="View" icon="pi pi-chart-line" text size="small"
                @click.stop="emit('session-selected', session.sessionId)" />
      </div>
    </div>
  </SessionListPanel>
</template>
