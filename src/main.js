import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initAnalytics } from './lib/analytics.js';

initAnalytics();

export default mount(App, { target: document.getElementById('app') });
