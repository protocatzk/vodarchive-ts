import { ref } from 'vue';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'voduploader-theme';

function currentFromDom(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const theme = ref<Theme>(currentFromDom());

function apply(next: Theme): void {
  theme.value = next;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Speicher nicht verfügbar – Auswahl gilt nur für die Sitzung. */
  }
}

export function useTheme() {
  return {
    theme,
    setTheme: apply,
    toggleTheme: () => apply(theme.value === 'dark' ? 'light' : 'dark'),
  };
}
