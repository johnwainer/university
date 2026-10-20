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

// El <html lang> venia fijo en index.html y el conmutador lo cambia en caliente
// sin tocar el atributo. Un lector de pantalla leia todo el portal con la
// pronunciacion del idioma equivocado.
//
// El respaldo de esta linea es 'en' y no 'es' desde que el idioma de arranque
// es el ingles: si i18next todavia no resolvio el idioma, el atributo debe
// decir lo mismo que se va a pintar.
const syncDocumentLanguage = (lng: string) => {
  document.documentElement.lang = lng.startsWith('es') ? 'es' : 'en';
};
syncDocumentLanguage(i18n.language ?? 'en');
i18n.on('languageChanged', syncDocumentLanguage);
