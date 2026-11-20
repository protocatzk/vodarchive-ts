<script setup lang="ts">
import { computed } from 'vue';
import type { ActiveJob } from '../types';

const props = defineProps<{ job: ActiveJob | null; connected: boolean }>();
const emit = defineEmits<{ (e: 'cancel', key: string): void }>();

const initial = computed(() => (props.job?.streamer || '?').charAt(0).toUpperCase());
const doneMb = computed(() => Math.round((props.job?.bytes_done ?? 0) / (1024 * 1024)));
const totalMb = computed(() => Math.round((props.job?.bytes_total ?? 0) / (1024 * 1024)));
const speed = computed(() =>
  props.job?.speed_mbps ? `${props.job.speed_mbps.toFixed(1)} MB/s` : '',
);
const eta = computed(() => (props.job?.eta_seconds ? `${Math.round(props.job.eta_seconds)}s Rest` : ''));
const cancelling = computed(() => props.job?.stage === 'cancelling');
</script>

<template>
  <div class="card">
    <div class="mb-4 flex items-center justify-between">
      <div class="card-title">Aktiver Upload</div>
      <span class="badge" :class="job ? 'badge-live' : 'badge-idle'">
        {{ job ? 'AKTIV' : 'IDLE' }}
      </span>
    </div>

    <div v-if="!job" class="flex flex-col items-center gap-1 py-10 text-center text-sm text-muted">
      <svg viewBox="0 0 24 24" class="h-8 w-8 fill-slate-600">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
      </svg>
      <div>Aktuell kein aktiver Upload in Bearbeitung.</div>
      <div class="text-xs">Der Bot wartet auf neue Aufnahmen.</div>
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center gap-3">
        <div
          class="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan text-lg font-bold text-white"
        >
          {{ initial }}
        </div>
        <div class="min-w-0">
          <h3 class="truncate text-base font-semibold text-white">{{ job.streamer }}</h3>
          <div class="truncate text-xs text-muted">
            📌 {{ job.title }} · ID: <code class="text-slate-400">{{ job.job_id }}</code>
          </div>
        </div>
      </div>

      <div>
        <div class="mb-1 flex items-center justify-between text-xs">
          <span class="text-cyan">{{ job.stage_label }}</span>
          <span class="font-semibold text-white">{{ job.pct }}%</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-gradient-to-r from-primary to-cyan transition-all"
            :style="{ width: `${job.pct}%` }"
          ></div>
        </div>
        <div class="mt-1 flex items-center justify-between text-xs text-muted">
          <span>{{ doneMb }} / {{ totalMb > 0 ? `${totalMb} MB` : '...' }}</span>
          <span>{{ [speed, eta].filter(Boolean).join(' • ') }}</span>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-danger"
          :disabled="cancelling"
          @click="emit('cancel', job.key)"
        >
          {{ cancelling ? 'Abbruch läuft…' : 'Job abbrechen' }}
        </button>
      </div>
    </div>
  </div>
</template>
