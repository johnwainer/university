/**
 * Subida de la foto de perfil al bucket del portal.
 *
 * Deliberadamente escueto y deliberadamente honesto, igual que el mailer: si
 * `AVATAR_BUCKET` no está definida o el SDK de S3 no está instalado, NO finge
 * una subida. Devuelve `configured: false` y el perfil sigue guardándose sin
 * foto. Un «subido» falso es peor que un «no configurado» verdadero.
 *
 * Por qué JSON con base64 y no multipart: Fastify no trae lector de multipart
 * y añadirlo son otra dependencia y otra superficie de ataque para un caso de
 * uso de 2 MB. El cuerpo llega como data URL, que es exactamente lo que el
 * navegador produce con FileReader, así que el front no necesita nada.
 *
 * `@aws-sdk/client-s3` se carga de forma perezosa y es opcional: un servidor
 * sin la dependencia arranca igual, como con el motor de PDF.
 */
import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';

export type ResultadoAvatar =
  | { configured: true; ok: true; url: string; objectKey: string }
  | { configured: boolean; ok: false; detail: string };

/** Tipos permitidos y su extensión. Nada de SVG: admite script embebido. */
const TIPOS_PERMITIDOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

let clientePromesa: Promise<any> | null = null;

async function getCliente(): Promise<any> {
  if (!clientePromesa) {
    clientePromesa = (async () => {
      const moduleName = ['@aws-sdk', 'client-s3'].join('/');
      const mod = (await import(/* @vite-ignore */ moduleName)) as {
        S3Client: new (cfg: Record<string, unknown>) => unknown;
      };
      // Sin credenciales explícitas: las resuelve la cadena por defecto del
      // SDK, que en esta instancia es el rol de EC2. Las claves del bucket que
      // usa el guion de despliegue NO se copian al .env del API.
      return new mod.S3Client({ region: config.avatars.region });
    })();
  }
  return clientePromesa;
}

/**
 * Decodifica la data URL y valida tipo y tamaño ANTES de tocar la red.
 */
export function leerImagenDataUrl(dataUrl: string):
  | { ok: true; bytes: Buffer; contentType: string; extension: string }
  | { ok: false; detail: string } {
  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    return { ok: false, detail: 'La imagen debe llegar como data URL en base64.' };
  }
  const contentType = match[1].toLowerCase();
  const extension = TIPOS_PERMITIDOS[contentType];
  if (!extension) {
    return {
      ok: false,
      detail: `Tipo de imagen no admitido (${contentType}). Se admiten JPEG, PNG y WebP.`
    };
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) {
    return { ok: false, detail: 'La imagen llegó vacía.' };
  }
  if (bytes.length > config.avatars.maxBytes) {
    const mb = (config.avatars.maxBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, detail: `La imagen pesa más de ${mb} MB.` };
  }
  return { ok: true, bytes, contentType, extension };
}

export function avatarConfigurado(): boolean {
  return Boolean(config.avatars.bucket && config.avatars.publicBase);
}

export async function subirAvatar(input: {
  dataUrl: string;
  /** Objeto anterior del mismo estudiante, para borrarlo tras subir el nuevo. */
  objectKeyAnterior?: string | null;
}): Promise<ResultadoAvatar> {
  // El ORDEN importa: primero se valida la imagen y sólo después se mira la
  // configuración. Al revés —como estaba— un servidor sin bucket aceptaba con
  // un 200 una imagen que con el bucket puesto daría 400: el estudiante veía
  // «guardado» en desarrollo y un error en producción con el mismo archivo. La
  // validación no toca la red, así que no cuesta nada hacerla primero.
  const imagen = leerImagenDataUrl(input.dataUrl);
  if (!imagen.ok) {
    return { configured: avatarConfigurado(), ok: false, detail: imagen.detail };
  }

  const motivos: string[] = [];
  if (!config.avatars.bucket) motivos.push('AVATAR_BUCKET no está definida');
  if (!config.avatars.publicBase) motivos.push('AVATAR_PUBLIC_BASE no está definida');
  if (motivos.length > 0) {
    return {
      configured: false,
      ok: false,
      detail: `${motivos.join('; ')}. La foto no se sube y el resto del perfil se guarda igual.`
    };
  }

  // Nombre aleatorio de 32 hexadecimales: el bucket es de lectura pública y un
  // nombre derivado del id del estudiante permitiría enumerar fotos.
  const objectKey = `${config.avatars.prefix}${randomBytes(16).toString('hex')}.${imagen.extension}`;

  try {
    const cliente = await getCliente();
    const moduleName = ['@aws-sdk', 'client-s3'].join('/');
    const { PutObjectCommand, DeleteObjectCommand } = (await import(
      /* @vite-ignore */ moduleName
    )) as { PutObjectCommand: any; DeleteObjectCommand: any };

    await cliente.send(
      new PutObjectCommand({
        Bucket: config.avatars.bucket,
        Key: objectKey,
        Body: imagen.bytes,
        ContentType: imagen.contentType,
        // Un año inmutable: el nombre cambia en cada subida, así que la URL
        // nueva nunca choca con la cacheada de la anterior.
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );

    // El objeto viejo se borra DESPUÉS de que el nuevo esté arriba. Al revés,
    // un fallo de subida dejaría al estudiante sin foto ninguna.
    if (input.objectKeyAnterior && input.objectKeyAnterior !== objectKey) {
      try {
        await cliente.send(
          new DeleteObjectCommand({ Bucket: config.avatars.bucket, Key: input.objectKeyAnterior })
        );
      } catch {
        // Un huérfano en el bucket no justifica fallar la petición del usuario.
      }
    }

    return {
      configured: true,
      ok: true,
      url: `${config.avatars.publicBase}/${objectKey}`,
      objectKey
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      detail: error instanceof Error ? error.message : 'No se pudo subir la imagen al bucket.'
    };
  }
}
