import { createRoot } from 'react-dom/client';
import App from './App';
import { initLayout } from './layout';
import './styles.css';
import './mobile.css';

document.documentElement.dataset.theme = localStorage.getItem('habitat:theme') || 'dark';
// Before the first render, so the layout doesn't visibly switch after mount.
initLayout();

/**
 * The hour of the day, as a part of it. The surfaces take a slight tint from it
 * — warm at either end of the day, cool in the small hours — so a habitat is
 * not the same flat colour at 7am and at midnight. Read from the clock, never
 * stored, and checked often enough to drift across a long-open window.
 */
const partOfDay = () => {
  const h = new Date().getHours();
  return h >= 5 && h < 9 ? 'dawn' : h < 17 && h >= 9 ? 'day' : h >= 17 && h < 21 ? 'dusk' : 'night';
};
const applyHour = () => {
  document.documentElement.dataset.hour = partOfDay();
};
applyHour();
setInterval(applyHour, 10 * 60 * 1000);

createRoot(document.getElementById('root')!).render(<App />);
