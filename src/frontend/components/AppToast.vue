<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { messages, dismiss } = useToast();
</script>

<template>
  <div class="toast-area">
    <TransitionGroup name="toast">
      <div
        v-for="message in messages"
        :key="message.id"
        class="pointer-events-auto w-full max-w-md cursor-pointer border bg-[var(--paper)] px-4 py-2 text-sm shadow-[0_10px_20px_-14px_rgba(42,35,24,0.6)]"
        :style="{
          borderColor:
            message.type === 'error'
              ? 'var(--oxblood)'
              : message.type === 'success'
                ? 'var(--sage)'
                : 'var(--rule)',
        }"
        @click="dismiss(message.id)"
      >
        <div class="flex items-start gap-3">
          <span
            class="typewriter text-[0.6rem] uppercase tracking-widest"
            :style="{
              color:
                message.type === 'error'
                  ? 'var(--oxblood)'
                  : message.type === 'success'
                    ? 'var(--sage)'
                    : 'var(--ink-faint)',
            }"
          >
            {{ message.type === 'error' ? 'Fehler' : message.type === 'success' ? 'Notiert' : 'Hinweis' }}
          </span>
          <span class="flex-1 font-serif">{{ message.message }}</span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
