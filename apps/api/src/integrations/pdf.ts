/**
 * Conversión de HTML a PDF etiquetado.
 *
 * El contrato (Cláusula 6) exige exportar la versión del estudiante «en PDF y
 * HTML accesible bajo WCAG 2.x AA». Un PDF accesible no es un PDF que se vea
 * bien: es un PDF *etiquetado*, con la estructura de encabezados, tablas y
 * listas incrustada, que es lo que un lector de pantalla recorre.
 *
 * Por eso se usa el motor de impresión del navegador sobre el mismo HTML
 * semántico que ya se sirve, en vez de dibujar el documento con una librería
 * de PDF: dibujar produce un PDF visualmente idéntico y completamente opaco
 * para quien lo navega con lector.
 *
 * Playwright se carga de forma perezosa y opcional. Si no está instalado, la
 * ruta de PDF responde 503 con un mensaje claro y la exportación HTML —que es
 * accesible por sí misma— sigue funcionando. Un servidor sin navegador no debe
 * impedir arrancar la API.
 */
let browserPromise: Promise<any> | null = null;

async function getBrowser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      // Import dinámico y por nombre calculado: si el paquete no está, esto
      // lanza y lo capturamos, en vez de romper el arranque del módulo.
      // El especificador se arma en runtime para que el compilador no exija
      // los tipos de un paquete que puede no estar instalado aquí.
      const moduleName = ['play', 'wright'].join('');
      const mod = (await import(/* @vite-ignore */ moduleName)) as {
        chromium: { launch: (options: unknown) => Promise<any> };
      };
      // `PDF_CHROMIUM_PATH` permite apuntar a un Chromium ya presente en la
      // máquina en vez de al que Playwright descarga. Sirve cuando el servidor
      // trae el navegador del sistema y no se quiere una segunda copia.
      const executablePath = process.env.PDF_CHROMIUM_PATH?.trim() || undefined;
      return mod.chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        ...(executablePath ? { executablePath } : {})
      });
    })();
  }
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const buffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        // `tagged` es lo que incrusta la estructura del documento.
        tagged: true,
        margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' }
      });
      return { ok: true, buffer };
    } finally {
      await page.close();
    }
  } catch (error) {
    // Se resetea para que un fallo transitorio no deje el navegador caído para
    // siempre; el siguiente intento vuelve a lanzarlo.
    browserPromise = null;
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo generar el PDF'
    };
  }
}
