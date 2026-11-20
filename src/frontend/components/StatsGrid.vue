<script setup lang="ts">
defineProps<{
  queueCount: number;
  topicCount: number;
  connected: boolean;
}>();
</script>

<template>
  <div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="card card-body">
      <span class="stat-label">Bot Status</span>
      <span class="stat-value" :class="connected ? 'text-emerald' : 'text-rose'">
        {{ connected ? 'Online' : 'Offline' }}
      </span>
    </div>
    <div class="card card-body">
      <span class="stat-label">Warteschlange</span>
      <span class="stat-value">{{ queueCount }} Jobs</span>
    </div>
    <div class="card card-body">
      <span class="stat-label">Topics gemappt</span>
      <span class="stat-value">{{ topicCount }}</span>
    </div>
    <div class="card card-body">
      <span class="stat-label">Ziel-Forum</span>
      <div class="font-display text-lg font-bold text-primary lg:text-xl">Ripper Archiv</div>
    </div>
  </div>
</template>
