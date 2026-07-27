import { ref } from 'vue';
import { api } from '../api/client';
import type { HealthStatus } from '@/utils/types';
import { createPoller } from '@/utils/polling';

const pollIntervalMs = 5000;

export const healthStatus = ref<HealthStatus | null>(null);

let healthRequest: Promise<void> | null = null;

/** Fetch service health, reusing a request already in progress. */
function fetchHealth(): Promise<void> {
  if (healthRequest) return healthRequest;

  healthRequest = api.getHealth().then((status) => {
    healthStatus.value = status;
  }).catch(() => {
    healthStatus.value = null;
  }).finally(() => {
    healthRequest = null;
  });

  return healthRequest;
}

const healthPoller = createPoller(() => {
  void fetchHealth();
}, pollIntervalMs);

/** Start health polling for one mounted consumer and return its cleanup handle. */
export function startHealthPolling(): () => void {
  void fetchHealth();
  return healthPoller.acquire();
}
