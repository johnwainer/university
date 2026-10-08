import React from 'react';
import ReactDOM from 'react-dom/client';
import './brand.css';
import i18n, { BRAND } from './i18n';
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

// El <html lang> venia fijo a "en" en index.html, pero el idioma por defecto es
// el espanol y el conmutador lo cambia en caliente sin tocar el atributo. Un
// lector de pantalla leia todo el portal con pronunciacion inglesa.
const syncDocumentLanguage = (lng: string) => {
  document.documentElement.lang = lng.startsWith('en') ? 'en' : 'es';
};
syncDocumentLanguage(i18n.language ?? 'es');
i18n.on('languageChanged', syncDocumentLanguage);
