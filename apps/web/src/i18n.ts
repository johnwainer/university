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
 * El valor anterior, "Atlas Online University", venía de la plantilla y
 * llegaba al sitio en producción: el pie decía «© 2026 Atlas Online
 * University» y el aviso de cumplimiento nombraba a Atlas.
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
    fallbackLng: 'es',
    supportedLngs: ['es', 'en'],
    detection: {
      order: ['localStorage', 'navigator'],
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
