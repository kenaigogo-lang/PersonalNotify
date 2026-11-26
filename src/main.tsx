import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'nes.css/css/nes.min.css';
import './index.css';
import './themes/nes.css';
import './themes/arcade.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
