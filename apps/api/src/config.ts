import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv();
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Las credenciales de administrador tenían valor por defecto en el código
 * ('dev-admin-key', 'CambiaEstaClave!2026'). Eso es cómodo en local y es un agujero
 * en producción: si la variable falta en el entorno, `x-admin-key: dev-admin-key`
 * basta para abrir las ~90 rutas /admin/*, expedientes de estudiantes incluidos,
 * y el fallo es silencioso —el servicio arranca igual—.
 *
 * Fuera de desarrollo el arranque se aborta. Es ruidoso a propósito: un proceso
 * que no levanta se ve en el primer despliegue; una clave por defecto activa no
 * se ve hasta que alguien la usa.
 */
const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

function requiredSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value;
  }
  if (isProduction) {
    throw new Error(
      `${name} no está definida. En producción no se admite un valor por defecto: ` +
        'defínela en el entorno (SSM o el .env del servicio) y vuelve a arrancar.'
    );
  }
  return devFallback;
}

export const config = {
  server: {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 4000),
    // URL pública de la API, tal y como la ve un estudiante. Se usa para
    // construir los enlaces del sílabo que se escriben en el aula de Moodle:
    // un enlace a 127.0.0.1 no le sirve a nadie. Sin ella, la publicación en
    // el aula se salta y se informa, en vez de escribir un enlace roto.
    publicUrl: (process.env.PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '')
  },
  isProduction,
  admin: {
    apiKey: requiredSecret('ADMIN_API_KEY', 'dev-admin-key'),
    email: process.env.ADMIN_EMAIL ?? 'admin@thefloridianuniversity.com',
    password: requiredSecret('ADMIN_PASSWORD', 'CambiaEstaClave!2026'),
    sessionTtlMinutes: Number(process.env.ADMIN_SESSION_TTL_MINUTES ?? 720)
  },
  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://tfu:tfu@localhost:5432/tfu'
  },
  moodle: {
    baseUrl: process.env.MOODLE_BASE_URL ?? '',
    token: process.env.MOODLE_TOKEN ?? ''
  },
  mail: {
    // Sin SMTP_URL no se envía nada y se dice: ver integrations/mailer.ts.
    smtpUrl: (process.env.SMTP_URL ?? '').trim(),
    from: process.env.MAIL_FROM ?? 'no-reply@thefloridianuniversity.com',
    // Destinatario de respaldo para los avisos de aula cuando el programa no
    // tiene decano cargado.
    academicContact: (process.env.ACADEMIC_CONTACT_EMAIL ?? '').trim()
  },
  /**
   * Fotos de perfil de los estudiantes.
   *
   * Van al bucket del portal porque es el único almacén de objetos que el rol
   * de esta instancia puede escribir (`plataforma-estudiantil-frontend.obj-mgmt`),
   * y se sirven por el CDN como cualquier estático. El nombre del objeto es
   * aleatorio: el bucket es de lectura pública y un nombre predecible —el id
   * del estudiante, por ejemplo— dejaría enumerar fotos de estudiantes.
   *
   * Sin `AVATAR_BUCKET` la subida NO se simula: responde que no está
   * configurada, igual que el mailer sin SMTP. El resto del perfil funciona.
   */
  avatars: {
    bucket: (process.env.AVATAR_BUCKET ?? '').trim(),
    prefix: (process.env.AVATAR_PREFIX ?? 'avatares/').trim(),
    region: (process.env.AWS_REGION ?? 'us-east-1').trim(),
    /** Base pública con la que se construye la URL servida al navegador. */
    publicBase: (process.env.AVATAR_PUBLIC_BASE ?? '').trim().replace(/\/+$/, ''),
    /** 2 MB. Una foto de perfil no necesita más y el límite frena el abuso. */
    maxBytes: Number(process.env.AVATAR_MAX_BYTES ?? 2 * 1024 * 1024)
  },
  institution: {
    name: process.env.INSTITUTION_NAME ?? 'University',
    ncesId: process.env.NCES_ID ?? '',
    ipedsCode: process.env.IPEDS_CODE ?? '',
    stateAuthorizationId: process.env.STATE_AUTHORIZATION_ID ?? '',
    regionalAccreditor: process.env.REGIONAL_ACCREDITOR ?? '',
    titleIxCoordinatorEmail: process.env.TITLE_IX_COORDINATOR_EMAIL ?? '',
    adaCoordinatorEmail: process.env.ADA_COORDINATOR_EMAIL ?? '',
    ferpaOfficerEmail: process.env.FERPA_OFFICER_EMAIL ?? ''
  }
};

let runtimeMoodleConfig = {
  baseUrl: config.moodle.baseUrl,
  token: config.moodle.token
};

function normalizeMoodleBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function getMoodleConfig(): { baseUrl: string; token: string } {
  return {
    baseUrl: runtimeMoodleConfig.baseUrl,
    token: runtimeMoodleConfig.token
  };
}

export function setMoodleConfig(input: { baseUrl: string; token: string }) {
  runtimeMoodleConfig = {
    baseUrl: normalizeMoodleBaseUrl(input.baseUrl),
    token: input.token.trim()
  };
}

export function hasMoodleConfig(): boolean {
  return Boolean(runtimeMoodleConfig.baseUrl && runtimeMoodleConfig.token);
}
