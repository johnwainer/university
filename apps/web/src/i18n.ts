import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.json';
import en from './locales/en.json';

/**
 * Marca de la institucion.
 *
 * El producto es multi-institucion: los textos no llevan el nombre escrito a
 * mano sino las variables {{brand}} y {{brandShort}}, que i18next resuelve en
 * cada cadena. Asi un mismo build sirve para cualquier institucion cambiando
 * una variable de entorno, sin tocar traducciones.
 *
 * Debe coincidir con INSTITUTION_NAME de la API, que es la fuente de verdad
 * del lado servidor.
 */
export const BRAND = import.meta.env.VITE_INSTITUTION_NAME ?? 'The Floridian University';
/*
 * El corto NO se deriva partiendo el nombre por el primer espacio: en "The
 * Floridian University" eso daba "The". El despliegue vigente es TFU, así que
 * ese es el valor por defecto, y cualquier otra institución lo fija por
 * entorno igual que el nombre largo.
 *
 * El valor anterior venía de la plantilla del producto anterior y llegaba al
 * sitio en producción: el pie y el aviso de cumplimiento nombraban a aquella
 * institución, no a TFU.
 */
export const BRAND_SHORT = import.meta.env.VITE_INSTITUTION_SHORT_NAME ?? 'TFU';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en }
    },
    /*
     * TFU pidió que la plataforma arranque SIEMPRE en inglés y que el idioma lo
     * cambie el usuario si quiere. Son dos cambios y los dos hacen falta:
     *
     *   fallbackLng: 'en'   el idioma de respaldo cuando no hay preferencia.
     *   detection.order     SIN 'navigator'.
     *
     * Dejar 'navigator' en la lista era justo lo que hacía que TFU viera el
     * portal en español: el detector preguntaba al navegador antes que nada, y
     * un equipo configurado en es-CO entraba en español. Peor aún, un navegador
     * en un tercer idioma (fr-FR) también caía en español por el fallbackLng
     * anterior. Verificado contra producción antes del cambio: en-US -> en,
     * es-CO -> es, fr-FR -> es.
     *
     * Con 'localStorage' como única fuente, el primer visitante entra en inglés
     * y su elección se guarda en cuanto toca el conmutador, así que la
     * preferencia de quien ya eligió se respeta igual que antes.
     */
    fallbackLng: 'en',
    supportedLngs: ['es', 'en'],
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'university-lang'
    },
    interpolation: {
      escapeValue: false,
      // Disponibles en toda cadena sin pasarlas en cada llamada a t().
      defaultVariables: {
        brand: BRAND,
        brandShort: BRAND_SHORT
      }
    }
  });

export default i18n;
