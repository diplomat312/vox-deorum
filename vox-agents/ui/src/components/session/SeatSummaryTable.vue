<script setup lang="ts">
/** Read-only seat summary shared by guided setup and saved configurations. */

import type { SeatRow } from '@/utils/session-summary';

defineProps<{
  seatRows: readonly SeatRow[];
  ariaLabel: string;
}>();
</script>

<template>
  <div class="table-seat-summary-scroll">
    <div class="table-seat-summary" role="table" :aria-label="ariaLabel">
      <div class="table-seat-summary-header" role="row">
        <span role="columnheader">Seat</span>
        <span role="columnheader">Plays as</span>
        <span role="columnheader">Style</span>
        <span role="columnheader">Thinks with</span>
      </div>
      <div v-for="seatRow in seatRows" :key="seatRow.seats" class="table-seat-summary-row" role="row">
        <span role="cell">{{ seatRow.seats }}</span>
        <span role="cell">{{ seatRow.role }}</span>
        <span role="cell">{{ seatRow.style }}</span>
        <span role="cell">{{ seatRow.model }}</span>
      </div>
    </div>
  </div>
</template>
