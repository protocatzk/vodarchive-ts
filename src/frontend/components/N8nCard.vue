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
  <div v-if="props.workflows.length > 0">
    <div class="sheet-head">
      <div class="sheet-title">Vorgänge · n8n</div>
      <span class="meta">Webhook-Register</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="name in props.workflows"
        :key="name"
        type="button"
        class="n8n-stamp"
        :title="`n8n-Workflow ${label(name)} starten`"
        @click="emit('run', name)"
      >
        {{ label(name) }}
      </button>
    </div>
  </div>
</template>
