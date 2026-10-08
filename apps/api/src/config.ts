import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv();
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Las credenciales de administrador tenían valor por defecto en el código
 * ('dev-admin-key', 'AtlasAdmin!2026'). Eso es cómodo en local y es un agujero
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
    port: Number(process.env.PORT ?? 4000)
  },
  isProduction,
  admin: {
    apiKey: requiredSecret('ADMIN_API_KEY', 'dev-admin-key'),
    email: process.env.ADMIN_EMAIL ?? 'admin@atlas.edu',
    password: requiredSecret('ADMIN_PASSWORD', 'AtlasAdmin!2026'),
    sessionTtlMinutes: Number(process.env.ADMIN_SESSION_TTL_MINUTES ?? 720)
  },
  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://atlas:atlas@localhost:5432/atlas'
  },
  moodle: {
    baseUrl: process.env.MOODLE_BASE_URL ?? '',
    token: process.env.MOODLE_TOKEN ?? ''
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
