import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Marca por defecto del producto. Un despliegue concreto la sobreescribe con
 * VITE_INSTITUTION_NAME en el momento del build (lo hace el script de
 * despliegue), sin tocar el repositorio.
 */
const DEFAULT_INSTITUTION_NAME = 'Atlas Online University';

/**
 * Sustituye %VITE_INSTITUTION_NAME% en index.html.
 *
 * Vite solo reemplaza esos marcadores cuando la variable esta definida; si no
 * lo esta, el literal llega al HTML y se ve como titulo de la pestana. Este
 * plugin garantiza un valor siempre.
 */
function institutionTitle() {
  const brand = process.env.VITE_INSTITUTION_NAME || DEFAULT_INSTITUTION_NAME;
  return {
    name: 'institution-title',
    transformIndexHtml(html: string) {
      return html.replaceAll('%VITE_INSTITUTION_NAME%', brand);
    }
  };
}

export default defineConfig({
  plugins: [react(), institutionTitle()],
  server: {
    port: 5174,
    strictPort: true
  }
});
