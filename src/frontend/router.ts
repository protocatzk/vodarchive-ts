import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from './views/DashboardView.vue';
import LoginView from './views/LoginView.vue';
import TopicsView from './views/TopicsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/topics', name: 'topics', component: TopicsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
