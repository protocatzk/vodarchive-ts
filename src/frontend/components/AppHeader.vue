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
    class="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-card-border pb-5"
  >
    <div class="flex items-center gap-3">
      <div
        class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-cyan shadow-brand-glow"
      >
        <svg viewBox="0 0 24 24" class="h-6 w-6 fill-white">
          <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10.5 6l-5-3v6l5-3z" />
        </svg>
      </div>
      <div>
        <div class="text-lg font-bold tracking-tight">Ripper VOD Uploader</div>
        <div class="text-xs text-muted">Automatisches Telegram Topic-Archiv</div>
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
      <RouterLink to="/topics" class="btn" active-class="bg-white/10">Topics verwalten</RouterLink>
      <button type="button" class="btn btn-danger" @click="logout">Abmelden</button>
    </div>
  </header>
</template>
