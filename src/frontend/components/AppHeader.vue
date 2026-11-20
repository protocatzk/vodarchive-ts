<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';

defineProps<{ user: string; connected: boolean }>();

const auth = useAuthStore();
const dashboard = useDashboardStore();
const router = useRouter();

async function logout(): Promise<void> {
  dashboard.disconnect();
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <header
    class="mb-8 flex flex-wrap items-center justify-between gap-6 border-b border-card-border pb-5"
  >
    <div class="flex items-baseline gap-4">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 28 28" class="h-6 w-6">
          <!-- Buch mit Zierrand (Archiv-Symbol) -->
          <path d="M5 5h18a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M9 3.5v20M15 3.5v20" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" />
          <path d="M5 9h18" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" />
          <path d="M9.5 11h5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" />
          <path d="M9.5 15h5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" />
          <path d="M9.5 19h5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" />
        </svg>
      </div>
      <div class="leading-tight">
        <div class="brand-title">voduploader</div>
        <div class="brand-subtitle">Archivierung von Stream-VODs</div>
        <div class="brand-tags">
          <span>Telegram</span>
          <span>rss.app</span>
          <span>VOD</span>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div
        class="flex items-center gap-2 rounded-full border border-card-border bg-white/5 px-3 py-1.5 text-sm font-medium"
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="connected ? 'bg-emerald' : 'bg-rose'"
          :title="connected ? 'Live-Verbindung aktiv' : 'Keine Live-Verbindung'"
        ></span>
        <span>{{ user || 'Autorisiert' }}</span>
      </div>
      <RouterLink to="/" class="btn" active-class="bg-white/10">Dashboard</RouterLink>
      <RouterLink to="/topics" class="btn" active-class="bg-white/10">Topics</RouterLink>
      <RouterLink to="/sources" class="btn" active-class="bg-white/10">Quellen</RouterLink>
      <RouterLink to="/workflows" class="btn" active-class="bg-white/10">Workflows</RouterLink>
      <RouterLink to="/settings" class="btn" active-class="bg-white/10">Einstellungen</RouterLink>
      <button type="button" class="btn btn-danger" @click="logout">Abmelden</button>
    </div>
  </header>
</template>
