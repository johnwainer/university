/**
 * Catálogos del perfil del estudiante.
 *
 * Los valores que se guardan en la base son claves estables en inglés y los
 * rótulos viven aquí en los dos idiomas. Es deliberado y es lo contrario de
 * guardar el texto que eligió el usuario:
 *
 *   - Un informe que agrupe por «familiaridad con IA» agrupa por clave, así que
 *     no se parte en dos grupos cuando un estudiante llenó el formulario en
 *     inglés y otro en español.
 *   - Cambiar la redacción de una opción no obliga a migrar filas.
 *
 * El API sirve estos catálogos en `GET /v1/profile/options`, de modo que el
 * portal y el panel pintan exactamente las mismas opciones sin copiarlas.
 */

export type OpcionCatalogo = {
  value: string;
  labelEs: string;
  labelEn: string;
};

/** Autoevaluación de familiaridad con IA. §«Self-assessed AI familiarity». */
export const FAMILIARIDAD_IA: OpcionCatalogo[] = [
  { value: 'none', labelEs: 'Ninguna', labelEn: 'None' },
  { value: 'casual', labelEs: 'Uso herramientas de forma casual', labelEn: 'Using tools casually' },
  { value: 'work', labelEs: 'Las uso en mi trabajo', labelEn: 'Using at work' },
  { value: 'building', labelEs: 'Construyo con ellas', labelEn: 'Building' }
];

/** Metas de aprendizaje. Es selección MÚLTIPLE: nadie estudia por un solo motivo. */
export const METAS_APRENDIZAJE: OpcionCatalogo[] = [
  { value: 'career_change', labelEs: 'Cambio de carrera', labelEn: 'Career change' },
  { value: 'promotion', labelEs: 'Ascenso', labelEn: 'Promotion' },
  { value: 'staying_relevant', labelEs: 'Mantenerme vigente', labelEn: 'Staying relevant' },
  {
    value: 'leading_adoption',
    labelEs: 'Liderar la adopción de IA en mi equipo',
    labelEn: "Leading a team's AI adoption"
  },
  { value: 'starting_business', labelEs: 'Emprender', labelEn: 'Starting a business' }
];

/** Medio de contacto preferido. */
export const CONTACTO_PREFERIDO: OpcionCatalogo[] = [
  { value: 'email', labelEs: 'Correo electrónico', labelEn: 'Email' },
  { value: 'phone', labelEs: 'Llamada telefónica', labelEn: 'Phone call' },
  { value: 'whatsapp', labelEs: 'WhatsApp', labelEn: 'WhatsApp' },
  { value: 'platform', labelEs: 'Mensaje en la plataforma', labelEn: 'Platform message' }
];

export const VALORES_FAMILIARIDAD_IA = FAMILIARIDAD_IA.map((o) => o.value);
export const VALORES_METAS_APRENDIZAJE = METAS_APRENDIZAJE.map((o) => o.value);
export const VALORES_CONTACTO_PREFERIDO = CONTACTO_PREFERIDO.map((o) => o.value);
