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
  <div>
    <div class="sheet-head">
      <div class="sheet-title">Aktiver Vorgang</div>
      <span class="stamp" :class="job ? 'stamp-red' : 'stamp-muted'">
        {{ job ? 'IN ARBEIT' : 'LEER' }}
      </span>
    </div>

    <div v-if="!job" class="py-12 text-center">
      <div class="typewriter text-sm" style="color: var(--ink-soft)">Kein Vorgang in Bearbeitung.</div>
    </div>

    <div v-else class="job-box">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="stat-label">Streamer</div>
          <div class="font-display text-lg font-bold leading-tight">{{ job?.streamer || 'Unbekannt' }}</div>
          <div class="job-stage truncate">{{ job?.title || 'Kein Titel' }}</div>
        </div>
        <span class="chip flex-none">Nr. {{ job?.job_id }}</span>
      </div>

      <div class="mt-5 flex items-baseline justify-between">
        <span class="stat-label">{{ job?.stage_label || 'Fortschritt' }}</span>
        <span class="job-pct">{{ job?.pct }}%</span>
      </div>
      <div class="job-bar mt-1">
        <div class="job-bar-fill" :style="{ width: `${job?.pct ?? 0}%` }"></div>
      </div>

      <div class="mt-2 flex flex-wrap justify-between gap-2 typewriter text-[0.64rem]" style="color: var(--ink-faint)">
        <span>{{ doneMb }} / {{ totalMb > 0 ? `${totalMb} MB` : '…' }}</span>
        <span>{{ [speed, eta].filter(Boolean).join(' · ') || '—' }}</span>
      </div>

      <div class="mt-4 flex justify-end border-t pt-3" style="border-top: 1px dotted var(--rule)">
        <button type="button" class="btn btn-danger" :disabled="cancelling" @click="emit('cancel', job?.key ?? '')">
          {{ cancelling ? 'Abbruch läuft …' : 'Vorgang abbrechen' }}
        </button>
      </div>
    </div>
  </div>
</template>
