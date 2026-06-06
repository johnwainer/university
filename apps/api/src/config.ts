import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv();
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

export const config = {
  server: {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 4000)
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY ?? 'dev-admin-key',
    email: process.env.ADMIN_EMAIL ?? 'admin@atlas.edu',
    password: process.env.ADMIN_PASSWORD ?? 'AtlasAdmin!2026',
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
