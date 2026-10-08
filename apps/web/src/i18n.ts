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
export const BRAND = import.meta.env.VITE_INSTITUTION_NAME ?? 'Atlas Online University';
export const BRAND_SHORT = import.meta.env.VITE_INSTITUTION_SHORT_NAME ?? BRAND.split(' ')[0];

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
