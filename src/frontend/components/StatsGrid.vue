<script setup lang="ts">
defineProps<{
  queueCount: number;
  topicCount: number;
  connected: boolean;
}>();
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <div class="card">
      <div class="stat-label">Bot Status</div>
      <div class="stat-value" :class="connected ? 'text-emerald' : 'text-rose'">
        {{ connected ? 'Online' : 'Offline' }}
      </div>
    </div>
    <div class="card">
      <div class="stat-label">Warteschlange</div>
      <div class="stat-value">{{ queueCount }} Jobs</div>
    </div>
    <RouterLink to="/topics" class="card block transition hover:border-primary/40">
      <div class="stat-label">Topics gemappt</div>
      <div class="stat-value">{{ topicCount }}</div>
    </RouterLink>
    <div class="card">
      <div class="stat-label">Ziel-Forum</div>
      <div class="text-lg font-bold text-indigo-300">Ripper Archiv</div>
    </div>
  </div>
</template>
