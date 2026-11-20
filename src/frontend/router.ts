import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from './views/DashboardView.vue';
import LoginView from './views/LoginView.vue';
import TopicsView from './views/TopicsView.vue';
import SourcesView from './views/SourcesView.vue';
import WorkflowsView from './views/WorkflowsView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/topics', name: 'topics', component: TopicsView },
    { path: '/sources', name: 'sources', component: SourcesView },
    { path: '/workflows', name: 'workflows', component: WorkflowsView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
