<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useTheme } from '../composables/useTheme';

defineProps<{ user: string; connected: boolean }>();

const auth = useAuthStore();
const dashboard = useDashboardStore();
const { theme, toggleTheme } = useTheme();
const router = useRouter();

const stand = computed(() =>
  new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }),
);

async function logout(): Promise<void> {
  dashboard.disconnect();
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <header class="masthead">
    <div class="masthead-row">
      <div class="crest">
        <div class="crest-mark" aria-hidden="true">
          <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.1">
            <path d="M5 5h18a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
            <path d="M9 3.5v20M15 3.5v20" stroke-width="0.8" />
            <path d="M5 9h18" stroke-width="0.8" />
            <path d="M9.5 11h4.5M9.5 14.5h4.5M9.5 18h4.5" stroke-width="0.8" stroke-linecap="round" />
          </svg>
        </div>
        <div>
          <div class="eyebrow">Bestand VOD · Registratur</div>
          <div class="wordmark">voduploader</div>
          <div class="tagline">Archiv für Stream-Aufzeichnungen</div>
        </div>
      </div>

      <div class="registry">
        <span>
          <span class="dot" :class="connected ? 'online' : 'offline'"></span>
          {{ connected ? 'verbunden' : 'offline' }}
        </span>
        <span>Leser: <strong>{{ user || 'Gast' }}</strong></span>
        <span class="stand">Stand: <strong>{{ stand }}</strong></span>
      </div>
    </div>

    <nav class="tabs" aria-label="Hauptbereiche">
      <RouterLink to="/" class="tab">Ablage</RouterLink>
      <RouterLink to="/topics" class="tab">Register</RouterLink>
      <RouterLink to="/sources" class="tab">Zugänge</RouterLink>
      <RouterLink to="/workflows" class="tab">Vorgänge</RouterLink>
      <RouterLink to="/settings" class="tab">Ordnung</RouterLink>
      <button
        type="button"
        class="tab tab-theme"
        :title="theme === 'dark' ? 'Zum Tagmodus wechseln' : 'Zum Nachtmodus wechseln'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☀ Tag' : '☾ Nacht' }}
      </button>
      <button type="button" class="tab tab-out" @click="logout">Abmelden</button>
    </nav>
  </header>
</template>
