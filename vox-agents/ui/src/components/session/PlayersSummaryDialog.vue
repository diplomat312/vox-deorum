<script setup lang="ts">
import CivilizationMindsDialog from './CivilizationMindsDialog.vue';

defineProps<{ visible: boolean }>();
defineEmits<{ 'update:visible': [value: boolean] }>();
</script>

<template>
  <CivilizationMindsDialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
  />
</template>
