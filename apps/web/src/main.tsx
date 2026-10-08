import React from 'react';
import ReactDOM from 'react-dom/client';
import { BRAND } from './i18n';
import { App } from './components/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// El titulo de la pestana sigue la misma marca que el resto de la interfaz.
// Se fija aqui porque index.html se sirve cacheado desde el CDN y su
// sustitucion de build no alcanza si la variable no estaba definida.
document.title = BRAND;
