<script setup lang="ts">
import AutoComplete from 'primevue/autocomplete';
import Select from 'primevue/select';
import type { AgentInfo } from '@/utils/types';
import type { PlayerOption } from './types';

const props = defineProps<{
  initiator: PlayerOption | null;
  initiatorOptions: PlayerOption[];
  role: string;
  suggestions: string[];
  voice: AgentInfo | null;
  voiceOptions: AgentInfo[];
  playersLoading: boolean;
  unifiedTarget?: boolean;
  targetLabel?: string;
  targetModel?: string;
}>();

defineEmits<{
  'update:initiator': [value: PlayerOption | null];
  'update:role': [value: string];
  'update:voice': [value: AgentInfo | null];
  'search-roles': [event: { query: string }];
}>();
</script>

<template>
  <div class="chat-launch-identity-step">
    <div class="chat-launch-identity-form">
      <label for="dipl-initiator">Speaking as (your seat)</label>
      <Select id="dipl-initiator" :modelValue="initiator" :options="initiatorOptions" optionLabel="label"
        placeholder="Select your seat..." :loading="playersLoading"
        @update:modelValue="$emit('update:initiator', $event)" />
      <label for="dipl-role">Your role</label>
      <AutoComplete id="dipl-role" :modelValue="role" :suggestions="suggestions"
        placeholder="e.g., the leader, a diplomat..." :dropdown="true"
        @update:modelValue="$emit('update:role', $event)" @complete="$emit('search-roles', $event)" />
      <template v-if="props.unifiedTarget">
        <div class="unified-target" data-testid="unified-target-summary">
          <span>Talking to</span>
          <strong>{{ props.targetLabel || 'Unified civilization mind' }}</strong>
          <small>Unified Civilization Mind · {{ props.targetModel || 'configured model' }}</small>
        </div>
      </template>
      <template v-else>
        <label for="dipl-voice">Voice (defaults to the target seat's diplomat)</label>
        <Select id="dipl-voice" :modelValue="voice" :options="voiceOptions" optionLabel="name"
          placeholder="Use the configured diplomat" showClear @update:modelValue="$emit('update:voice', $event)" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.unified-target {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem;
  border: 1px solid var(--p-primary-color);
  border-radius: 6px;
}
.unified-target span, .unified-target small { color: var(--p-text-secondary-color); }
</style>
