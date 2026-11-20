<script setup lang="ts">
defineProps<{
  queueCount: number;
  topicCount: number;
  connected: boolean;
}>();
</script>

<template>
  <div class="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="index-card">
      <div class="stat-label">Registratur</div>
      <div class="stat-value" :style="{ color: connected ? 'var(--sage)' : 'var(--oxblood)' }">
        {{ connected ? 'Online' : 'Offline' }}
      </div>
    </div>

    <div class="index-card">
      <div class="stat-label">Warteschlange</div>
      <div class="stat-value">{{ queueCount }}</div>
    </div>

    <div class="index-card">
      <div class="stat-label">Register</div>
      <div class="stat-value">{{ topicCount }}</div>
    </div>

    <div class="index-card">
      <div class="stat-label">Bestand</div>
      <div class="stat-value" style="font-size: 1.35rem; color: var(--oxblood)">Ripper Archiv</div>
    </div>
  </div>
</template>
