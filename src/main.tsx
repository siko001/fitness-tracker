import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './safe-area.css';
import './themes.css';
import { applyAppearance, readAppearance } from './appearance';

applyAppearance(readAppearance());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
