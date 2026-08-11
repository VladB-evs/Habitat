import { createRoot } from 'react-dom/client';
import App from './App';
import { initLayout } from './layout';
import './styles.css';
import './mobile.css';

document.documentElement.dataset.theme = localStorage.getItem('habitat:theme') || 'dark';
// Before the first render, so the layout doesn't visibly switch after mount.
initLayout();

createRoot(document.getElementById('root')!).render(<App />);
