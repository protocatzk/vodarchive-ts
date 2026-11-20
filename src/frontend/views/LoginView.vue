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
const status = ref('Initialisiere Login-Token …');
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
      status.value = `Angemeldet als ${result.user ?? 'Admin'} – Eintritt gewährt.`;
      await goDashboard();
      return;
    }
    if (result.status === 'denied') {
      stopPolling();
      failed.value = true;
      status.value = 'Zutritt wurde in Telegram verweigert.';
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
      status.value = `Angemeldet als ${data.user ?? 'Admin'} – Eintritt gewährt.`;
      await goDashboard();
      return;
    }
    token.value = data.token;
    deepLink.value = data.deep_link;
    botUsername.value = data.bot_username;
    status.value = 'Warte auf Bestätigung in Telegram …';
    pollTimer = setInterval(check, 2000);
  } catch (error) {
    failed.value = true;
    status.value = errorMessage(error, 'Login konnte nicht initialisiert werden.');
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="fixed inset-0 z-10 flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-md">
      <div class="sheet" style="padding: 2rem 1.8rem">
        <div class="text-center">
          <div class="crest-mark mx-auto" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.1">
              <path d="M5 5h18a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
              <path d="M9 3.5v20M15 3.5v20" stroke-width="0.8" />
              <path d="M5 9h18" stroke-width="0.8" />
              <path d="M9.5 11h4.5M9.5 14.5h4.5M9.5 18h4.5" stroke-width="0.8" stroke-linecap="round" />
            </svg>
          </div>
          <div class="eyebrow mt-4">Lesesaal · Zutritt</div>
          <div class="wordmark">voduploader</div>
          <div class="tagline">Archiv für Stream-Aufzeichnungen</div>
        </div>

        <hr class="rule-double" />

        <p class="text-center italic" style="color: var(--ink-soft)">
          Bitte weise dich am Lesesaal aus. Die Bestätigung erfolgt über Telegram.
        </p>

        <a
          v-if="deepLink"
          :href="deepLink"
          target="_blank"
          rel="noopener"
          class="btn btn-primary mt-5 w-full justify-center py-3"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 fill-current">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
          </svg>
          Mit Telegram bestätigen
        </a>

        <div
          class="mt-4 border px-3 py-2 text-sm"
          :style="{
            borderColor: failed ? 'var(--oxblood)' : 'var(--rule)',
            color: failed ? 'var(--oxblood)' : 'var(--ink-soft)',
            background: '#fbf6e8',
          }"
        >
          <span class="typewriter text-[0.6rem] uppercase tracking-widest mr-2" style="color: var(--ink-faint)">
            {{ failed ? 'Fehler' : 'Status' }}
          </span>
          {{ status }}
        </div>

        <button
          v-if="deepLink && !failed"
          type="button"
          class="btn mt-3 w-full justify-center"
          :disabled="busy"
          @click="check"
        >
          Ich habe bestätigt
        </button>

        <hr class="rule" />

        <div class="meta text-center">
          Nur autorisierte Konten erhalten Zutritt.
          <span v-if="botUsername"> · Bot @{{ botUsername }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
