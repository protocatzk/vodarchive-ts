<script setup lang="ts">
const props = defineProps<{ workflows: string[] }>();
const emit = defineEmits<{ (e: 'run', name: string): void }>();

const LABELS: Record<string, string> = {
  karbfenchieff: 'Karbfen',
  karpfenchieff: 'Karpfen',
  ripperchieff: 'Ripper',
};

function label(name: string): string {
  return LABELS[name] ?? name;
}
</script>

<template>
  <div v-if="props.workflows.length > 0" class="card">
    <div class="mb-3 card-title">n8n-Workflows</div>
    <div class="mb-3 text-xs text-muted">
      Startet den Streamrecorder-Workflow des jeweiligen Accounts sofort – zusätzlich zum
      15-Minuten-Intervall.
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="name in props.workflows"
        :key="name"
        type="button"
        class="btn text-xs"
        :title="`n8n-Workflow ${label(name)} starten`"
        @click="emit('run', name)"
      >
        {{ label(name) }}
      </button>
    </div>
  </div>
</template>
