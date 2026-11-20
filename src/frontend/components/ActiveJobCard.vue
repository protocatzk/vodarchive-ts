<script setup lang="ts">
import { computed } from 'vue';
import type { ActiveJob } from '../types';

const props = defineProps<{ job: ActiveJob | null; connected: boolean }>();
const emit = defineEmits<{ (e: 'cancel', key: string): void }>();

const doneMb = computed(() => Math.round((props.job?.bytes_done ?? 0) / (1024 * 1024)));
const totalMb = computed(() => Math.round((props.job?.bytes_total ?? 0) / (1024 * 1024)));
const speed = computed(() =>
  props.job?.speed_mbps ? `${props.job.speed_mbps.toFixed(1)} MB/s` : '',
);
const eta = computed(() => (props.job?.eta_seconds ? `${Math.round(props.job.eta_seconds)}s Rest` : ''));
const cancelling = computed(() => props.job?.stage === 'cancelling');
</script>

<template>
  <div class="card job-box h-full flex flex-col">
    <div class="card-inner flex flex-1 flex-col">
      <div class="flex items-center justify-between">
        <div class="flex items-baseline gap-3">
          <div class="brand-mark hidden h-8 w-8 sm:block">
            <svg viewBox="0 0 28 28" class="h-5 w-5"><path d="M5 5h18a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.2" /><path d="M9 3.5v20M15 3.5v20" stroke="currentColor" stroke-width="0.9" /><path d="M5 9h18" stroke="currentColor" stroke-width="0.9" /></svg>
          </div>
          <div>
            <div class="stat-label">Aktiver Upload</div>
            <h3 class="font-display text-base font-semibold tracking-tight text-text">{{ job?.streamer || 'Unbekannt' }}</h3>
            <div class="font-display text-sm italic text-text-muted truncate">{{ job?.title || 'Kein Titel' }}</div>
          </div>
        </div>
        <span class="badge" :class="job ? 'badge-live' : 'badge-idle'">{{ job ? 'AKTIV' : 'IDLE' }}</span>
      </div>

      <div v-if="!job" class="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <svg viewBox="0 0 28 28" class="h-9 w-9 text-text-muted"><path d="M14 6v16" stroke="currentColor" stroke-width="1.2"/></svg>
        <div class="font-display text-sm text-text">Aktuell kein aktiver Upload.</div>
        <div class="max-w-sm text-xs text-text-muted">Der Bot wartet auf neue Aufnahmen aus n8n.</div>
      </div>

      <div v-else class="space-y-4">
        <div>
          <div class="job-stage">{{ job.title || 'Kein Titel' }}</div>
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-display text-xl font-bold text-text">{{ job.pct }}%</span>
            <span class="text-sm text-muted">{{ job.job_id }}</span>
          </div>
        </div>

        <div class="job-bar">
          <div class="job-bar-fill" :style="{ width: `${job.pct}%` }"></div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs text-muted">{{ doneMb }} / {{ totalMb > 0 ? `${totalMb} MB` : '...' }}</div>
          <div class="text-xs text-muted">{{ [speed, eta].filter(Boolean).join(' • ') }}</div>
        </div>

        <div class="flex justify-end">
          <button
            type="button"
            class="btn btn-danger"
            :disabled="cancelling"
            @click="emit('cancel', job?.key ?? '')"
          >
            {{ cancelling ? 'Abbruch läuft…' : 'Job abbrechen' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
