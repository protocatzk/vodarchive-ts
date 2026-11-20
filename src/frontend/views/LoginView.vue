<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { errorMessage } from '../lib/api';

const auth = useAuthStore();
const router = useRouter();

const token = ref('');
const deepLink = ref('');
const botUsername = ref('');
const status = ref('Initialisiere Login-Token...');
const busy = ref(false);
const failed = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function goDashboard(): Promise<void> {
  stopPolling();
  await auth.fetchSession();
  router.push('/');
}

async function check(): Promise<void> {
  if (!token.value || busy.value) return;
  busy.value = true;
  try {
    const result = await auth.checkToken(token.value);
    if (result.status === 'approved') {
      status.value = `Angemeldet als ${result.user ?? 'Admin'} – weiter zum Dashboard...`;
      await goDashboard();
      return;
    }
    if (result.status === 'denied') {
      stopPolling();
      failed.value = true;
      status.value = 'Anmeldung wurde in Telegram abgelehnt.';
      return;
    }
    if (result.status === 'expired') {
      stopPolling();
      failed.value = true;
      status.value = 'Login-Token abgelaufen. Bitte Seite neu laden.';
      return;
    }
  } catch (error) {
    status.value = errorMessage(error, 'Prüfung fehlgeschlagen.');
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await auth.requestLogin();
    if (data.status === 'approved') {
      status.value = `Angemeldet als ${data.user ?? 'Admin'} – weiter zum Dashboard...`;
      await goDashboard();
      return;
    }
    token.value = data.token;
    deepLink.value = data.deep_link;
    botUsername.value = data.bot_username;
    status.value = 'Warte auf Bestätigung in Telegram...';
    pollTimer = setInterval(check, 2000);
  } catch (error) {
    failed.value = true;
    status.value = errorMessage(error, 'Login konnte nicht initialisiert werden.');
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md items-center px-4">
    <div class="card w-full text-center">
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-cyan shadow-brand-glow"
      >
        <svg viewBox="0 0 24 24" class="h-7 w-7 fill-white">
          <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10.5 6l-5-3v6l5-3z" />
        </svg>
      </div>
      <h1 class="text-xl font-bold">VOD Uploader Dashboard</h1>
      <p class="mt-2 text-sm text-muted">
        Klicke auf den Button, um die Anmeldung direkt in Telegram freizugeben.
      </p>

      <a
        v-if="deepLink"
        :href="deepLink"
        target="_blank"
        rel="noopener"
        class="btn btn-primary mt-6 w-full py-2.5"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-white">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z"
          />
        </svg>
        Mit Telegram bestätigen
      </a>

      <div
        class="mt-5 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
        :class="failed ? 'border-rose/40 bg-rose/10 text-rose' : 'border-card-border bg-white/5 text-slate-200'"
      >
        <span
          v-if="!failed"
          class="h-4 w-4 animate-spin rounded-full border-2 border-primary/40 border-t-primary"
        ></span>
        <span>{{ status }}</span>
      </div>

      <button v-if="deepLink && !failed" type="button" class="btn mt-3 w-full text-xs" :disabled="busy" @click="check">
        Ich habe bestätigt
      </button>

      <div class="mt-5 text-xs text-muted">
        Nur autorisierte Telegram-Konten haben Zugriff.
        <span v-if="botUsername"> Bot: @{{ botUsername }}</span>
      </div>
    </div>
  </div>
</template>
