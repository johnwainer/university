/**
 * Eventos en vivo y podcasts de Peregrine Corporate Learning.
 *
 * Sustituye al contenido demo de "Atlas Online University" que quedaba de la
 * plantilla (casa abierta de admisiones, métodos de investigación...), que no
 * tiene nada que ver con la oferta real.
 *
 * Dos decisiones de diseño:
 *
 *   - Lo viejo se DESACTIVA, no se borra. Un webinar borrado se lleva por
 *     delante cualquier reserva o enlace repartido; `is_active = false` deja el
 *     mismo resultado visible y es reversible desde el panel admin.
 *
 *   - El registro apunta al formulario del corporativo
 *     (peregrineeducationus.com/#contact) en vez de inventar un código de
 *     YouTube: un enlace falso a un vídeo que no existe es peor que no tener
 *     enlace. Cuando haya sala real, se cambia `source_url` desde el admin.
 *
 * Idempotente: cada fila se localiza por slug (o por código de vídeo) y se
 * actualiza; correr el script dos veces no duplica nada.
 *
 * Uso:  node dist/scripts/seed-peregrine-media.js
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';

const REGISTRO = 'https://peregrineeducationus.com/#contact';

type Evento = {
  slug: string;
  startsAt: string;
  hero: string;
  es: { title: string; subtitle: string; description: string; cta: string };
  en: { title: string; subtitle: string; description: string; cta: string };
};

/** Imágenes: las mismas del programa con el que se relaciona cada sesión. */
const u = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=80`;

const EVENTOS: Evento[] = [
  {
    slug: 'pcl-live-discovery-consultiva',
    startsAt: '2026-11-12T16:00:00Z',
    hero: u('1556761175-4b46a572b786'),
    es: {
      title: 'Descubrimiento consultivo: diagnosticar antes de recomendar',
      subtitle: 'Sesión en vivo · Ventas y Crecimiento de Ingresos',
      description:
        'Una hora de práctica sobre la parte de la venta donde se decide todo: las preguntas. Cómo descubrir necesidad, impacto y proceso de decisión antes de proponer nada.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'Consultative discovery: diagnose before you recommend',
      subtitle: 'Live session · Sales and Revenue Growth',
      description:
        'One hour of practice on the part of the sale where everything is decided: the questions. How to uncover need, impact and the decision process before proposing anything.',
      cta: 'Save my seat'
    }
  },
  {
    slug: 'pcl-live-ia-en-el-trabajo',
    startsAt: '2026-11-26T17:00:00Z',
    hero: u('1677442136019-21780ecad995'),
    es: {
      title: 'IA en el trabajo: de la curiosidad al resultado medible',
      subtitle: 'Sesión en vivo · IA — Capacidad Transversal',
      description:
        'Qué tareas conviene delegar en IA y cuáles no, cómo medir si realmente ahorra tiempo, y qué cambia en el flujo de trabajo de un equipo cuando deja de ser un experimento.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'AI at work: from curiosity to measurable results',
      subtitle: 'Live session · AI — Cross-Cutting Capability',
      description:
        'Which tasks are worth delegating to AI and which are not, how to measure whether it actually saves time, and what changes in a team workflow once it stops being an experiment.',
      cta: 'Save my seat'
    }
  },
  {
    slug: 'pcl-live-liderar-a-distancia',
    startsAt: '2026-12-10T16:00:00Z',
    hero: u('1600880292203-757bb62b4baf'),
    es: {
      title: 'Liderar a distancia sin perder claridad ni responsabilidad',
      subtitle: 'Sesión en vivo · e-Liderazgo y Gestión de Equipos Remotos',
      description:
        'La distancia cambia cómo trabaja un equipo; no tiene por qué debilitar cómo se le lidera. Rutinas de seguimiento, conversaciones de desempeño y decisiones que no se quedan atascadas.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'Leading at a distance without losing clarity or accountability',
      subtitle: 'Live session · e-Leadership & Remote Team Management',
      description:
        'Distance changes how a team works; it does not have to weaken how it is led. Follow-up routines, performance conversations and decisions that stop getting stuck.',
      cta: 'Save my seat'
    }
  },
  {
    slug: 'pcl-live-experiencia-cliente',
    startsAt: '2027-01-14T17:00:00Z',
    hero: u('1521791136064-7986c2920216'),
    es: {
      title: 'La experiencia del cliente como motor de ingresos',
      subtitle: 'Sesión en vivo · Experiencia del Cliente',
      description:
        'Dónde se pierde y dónde se gana un cliente después de la primera venta: retención, señales de abandono, y las conversaciones que abren venta cruzada sin forzarla.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'Customer experience as a revenue engine',
      subtitle: 'Live session · Customer Experience',
      description:
        'Where a customer is won and lost after the first sale: retention, churn signals, and the conversations that open cross-sell without forcing it.',
      cta: 'Save my seat'
    }
  },
  {
    slug: 'pcl-live-evaluacion-autentica',
    startsAt: '2027-01-28T16:00:00Z',
    hero: u('1523240795612-9a054b0db644'),
    es: {
      title: 'Más allá de la prueba anti-IA: evaluar aprendizaje real',
      subtitle: 'Sesión en vivo · Transformación Educativa',
      description:
        'Para equipos académicos: cómo diseñar evaluaciones que muestren evidencia de aprendizaje en lugar de intentar, sin éxito, cerrarle la puerta a la IA.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'Beyond AI-proofing: assessing real learning',
      subtitle: 'Live session · Education Transformation',
      description:
        'For academic teams: how to design assessment that shows evidence of learning instead of trying, unsuccessfully, to shut AI out.',
      cta: 'Save my seat'
    }
  },
  {
    slug: 'pcl-live-una-sola-red',
    startsAt: '2027-02-11T17:00:00Z',
    hero: u('1577896851231-70ef18881754'),
    es: {
      title: 'Operar como una sola red: qué estandarizar y qué dejar local',
      subtitle: 'Sesión en vivo · IA — Capacidad Transversal',
      description:
        'Para grupos multi-sede y franquicias: cómo decidir qué se estandariza, quién tiene autoridad sobre qué, y cómo se difunde una práctica que funcionó en una sede.',
      cta: 'Reservar cupo'
    },
    en: {
      title: 'Operating as one network: what to standardize, what to keep local',
      subtitle: 'Live session · AI — Cross-Cutting Capability',
      description:
        'For multi-location groups and franchises: how to decide what gets standardized, who has authority over what, and how a practice that worked in one site spreads.',
      cta: 'Save my seat'
    }
  }
];

/**
 * Los podcasts conservan los códigos de YouTube que ya estaban porque son
 * vídeos reales que cargan miniatura; lo que cambia es el título, que hablaba
 * de gestión universitaria y ahora corresponde a la oferta corporativa.
 */
const PODCASTS: Array<{ code: string; order: number; es: string; en: string }> = [
  { code: 'UF8uR6Z6KLc', order: 10, es: 'Liderar equipos que no comparten oficina', en: 'Leading teams that do not share an office' },
  { code: 'arj7oStGLkU', order: 11, es: 'Conversaciones difíciles sin romper la relación', en: 'Difficult conversations without breaking the relationship' },
  { code: '8jPQjjsBbIc', order: 12, es: 'Qué medir para saber si la formación funcionó', en: 'What to measure to know whether training worked' },
  { code: 'ZXsQAXx_ao0', order: 13, es: 'IA y rigor académico: el falso dilema', en: 'AI and academic rigor: the false dilemma' }
];

async function main(): Promise<void> {
  // 1. Retirar el contenido demo heredado, sin borrarlo.
  //    'seminario-investigacion-academica' no lleva el prefijo demo- pero es
  //    igual de placeholder: lo crea ensureSeedData() cuando la tabla está
  //    vacía, y su enlace apunta a un vídeo de relleno.
  const retiradosWebinars = await pool.query(
    `UPDATE webinars SET is_active = false, show_on_landing = false, updated_at = NOW()
     WHERE (slug LIKE 'demo-%' OR slug = 'seminario-investigacion-academica')
       AND (is_active OR show_on_landing)`
  );

  // 2. Eventos en vivo.
  for (const e of EVENTOS) {
    await pool.query(
      `
        INSERT INTO webinars
          (id, slug, title, subtitle, description, hero_image, source_type, source_url,
           starts_at, ends_at, timezone, cta_label, is_active, show_on_landing,
           title_en, subtitle_en, description_en, cta_label_en)
        VALUES
          ($1, $2, $3, $4, $5, $6, 'external', $7,
           $8, $9, 'America/New_York', $10, true, true,
           $11, $12, $13, $14)
        ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            subtitle = EXCLUDED.subtitle,
            description = EXCLUDED.description,
            hero_image = EXCLUDED.hero_image,
            source_type = EXCLUDED.source_type,
            source_url = EXCLUDED.source_url,
            starts_at = EXCLUDED.starts_at,
            ends_at = EXCLUDED.ends_at,
            timezone = EXCLUDED.timezone,
            cta_label = EXCLUDED.cta_label,
            is_active = true,
            show_on_landing = true,
            title_en = EXCLUDED.title_en,
            subtitle_en = EXCLUDED.subtitle_en,
            description_en = EXCLUDED.description_en,
            cta_label_en = EXCLUDED.cta_label_en,
            updated_at = NOW()
      `,
      [
        randomUUID(),
        e.slug,
        e.es.title,
        e.es.subtitle,
        e.es.description,
        e.hero,
        REGISTRO,
        e.startsAt,
        new Date(Date.parse(e.startsAt) + 90 * 60000).toISOString(),
        e.es.cta,
        e.en.title,
        e.en.subtitle,
        e.en.description,
        e.en.cta
      ]
    );
  }

  // 3. Podcasts: mismos vídeos, títulos de la oferta corporativa.
  for (const p of PODCASTS) {
    const updated = await pool.query(
      `UPDATE podcasts
         SET title = $1, title_en = $2, display_order = $3, is_active = true,
             show_on_landing = true, updated_at = NOW()
       WHERE video_code = $4`,
      [p.es, p.en, p.order, p.code]
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO podcasts
           (id, title, title_en, video_code, video_url, published_at, is_active, show_on_landing, display_order)
         VALUES ($1, $2, $3, $4, $5, NOW(), true, true, $6)`,
        [randomUUID(), p.es, p.en, p.code, `https://www.youtube.com/watch?v=${p.code}`, p.order]
      );
    }
  }

  console.log(`demo retirados : ${retiradosWebinars.rowCount}`);
  console.log(`eventos        : ${EVENTOS.length}`);
  console.log(`podcasts       : ${PODCASTS.length}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
