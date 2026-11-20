<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { messages, dismiss } = useToast();
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <TransitionGroup name="toast">
      <div
        v-for="message in messages"
        :key="message.id"
        class="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur"
        :class="{
          'border-[rgba(159,61,68,0.4)] bg-[rgba(159,61,68,0.15)] text-rose': message.type === 'error',
          'border-emerald/40 bg-emerald/15 text-emerald': message.type === 'success',
          'border-card-border bg-slate-800/90 text-slate-100': message.type === 'info',
        }"
        @click="dismiss(message.id)"
      >
        <span class="flex-1">{{ message.message }}</span>
        <span class="cursor-pointer text-xs opacity-60">✕</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
