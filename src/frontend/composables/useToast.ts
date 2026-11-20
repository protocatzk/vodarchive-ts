import { ref } from 'vue';

export interface ToastMessage {
  id: number;
  message: string;
  type: 'info' | 'error' | 'success';
}

const messages = ref<ToastMessage[]>([]);
let counter = 0;

export function useToast() {
  function show(message: string, type: ToastMessage['type'] = 'info'): void {
    const id = ++counter;
    messages.value.push({ id, message, type });
    setTimeout(() => {
      messages.value = messages.value.filter((entry) => entry.id !== id);
    }, 4500);
  }

  function dismiss(id: number): void {
    messages.value = messages.value.filter((entry) => entry.id !== id);
  }

  return { messages, show, dismiss };
}
