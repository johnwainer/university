/**
 * Catálogo bilingüe de los programas de Peregrine Corporate Learning.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO SE LEE DE MOODLE
 *   Los cursos SÍ guardan su texto en Moodle con marcado multilang
 *   ({mlang en}...{mlang}{mlang es}...{mlang}) y el filtro está activo, así que
 *   dentro del LMS cada alumno ve su idioma. Lo que no sirve es leerlo desde
 *   aquí: core_course_get_courses pasa `fullname` y `summary` por
 *   external_format_string(), que aplica los filtros ANTES de responder, y
 *   devuelve ya resuelto el idioma del sitio. Se comprobaron las dos salidas
 *   documentadas para evitarlo, moodlewssettingfilter=0 y
 *   moodlewssettinglang=es: ambas siguen devolviendo inglés. Apagar el filtro
 *   arreglaría el web service pero dejaría las llaves a la vista en el aula.
 *
 *   Así que el portal se sirve de este módulo —igual que COURSE_I18N ya hacía
 *   con los cursos demo de Atlas— y Moodle conserva su propio texto bilingüe
 *   para el aula. Si algún día el web service devolviera el marcado crudo,
 *   parseMultilang() en db.ts ya lo resuelve y esto pasa a ser el respaldo.
 *
 * ORIGEN DEL CONTENIDO
 *   Textos e imágenes tomados de peregrineeducationus.com, de sus propias
 *   versiones inglesa y española (?lang=es). No son traducciones nuestras: son
 *   las que publica Peregrine. Las horas también son las del corporativo.
 *   "Leading Business as One Network" y "Leading Schools as One Learning
 *   Network" comparten foto porque el corporativo hace lo mismo: es el mismo
 *   programa para dos audiencias.
 *
 * La clave es el shortname del curso en Moodle, en mayúsculas.
 */
export type LocalizedText = { es: string; en: string };

export type PeregrineProgram = {
  /** Portada, la misma que usa la ficha del programa en el corporativo. */
  hero: string;
  /** Duración oficial en horas. */
  hours: number;
  title: LocalizedText;
  /** Texto plano para tarjetas y buscador: lema + entradilla. */
  summary: LocalizedText;
  /** HTML completo para la ficha: lema, entradilla y lo que se practica. */
  summaryHtml: LocalizedText;
};

export const PEREGRINE_CATALOG: Record<string, PeregrineProgram> = {
  'PCL-SALES-EXC': {
    hero: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&w=1400&q=80',
    hours: 12,
    title: {
      es: 'Excelencia en Ventas',
      en: 'Sales Excellence'
    },
    summary: {
      es: 'Crea más valor. Convierte más oportunidades. Cierra con consistencia. Construye la confianza, la habilidad y la disciplina que tu equipo necesita para liderar mejores conversaciones de venta, manejar la resistencia, mejorar la conversión y elevar el desempeño comercial.',
      en: 'Create more value. Convert more opportunities. Close with consistency. Build the confidence, skill, and discipline your team needs to lead stronger sales conversations, handle resistance, improve conversion, and drive better sales performance.'
    },
    summaryHtml: {
      es: '<p><strong>Crea más valor. Convierte más oportunidades. Cierra con consistencia.</strong></p><p>Construye la confianza, la habilidad y la disciplina que tu equipo necesita para liderar mejores conversaciones de venta, manejar la resistencia, mejorar la conversión y elevar el desempeño comercial.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li><strong>DESCUBRIMIENTO CONSULTIVO:</strong> Diagnostica antes de recomendar. Haz preguntas con propósito para descubrir necesidades, impacto, prioridades, interesados y el proceso de decisión.</li><li><strong>VALOR ESPECÍFICO PARA EL CLIENTE:</strong> Convierte lo que aprendes en valor relevante. Conecta las soluciones con lo que el cliente dice que realmente importa, no con características genéricas ni suposiciones.</li><li><strong>OBJECIONES Y NEGOCIACIÓN:</strong> Resuelve la preocupación real protegiendo el valor. Diagnostica las objeciones antes de responder, negocia con disciplina y evita descuentos innecesarios.</li><li><strong>CLARIDAD DE DECISIÓN Y SEGUIMIENTO:</strong> Haz avanzar las oportunidades con propósito. Pide el compromiso adecuado, establece próximos pasos claros, mantén el impulso y fortalece la relación.</li></ul>',
      en: '<p><strong>Create more value. Convert more opportunities. Close with consistency.</strong></p><p>Build the confidence, skill, and discipline your team needs to lead stronger sales conversations, handle resistance, improve conversion, and drive better sales performance.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li><strong>CONSULTATIVE DISCOVERY:</strong> Diagnose before you recommend. Ask purposeful questions to uncover needs, impact, priorities, stakeholders, and the decision process.</li><li><strong>CUSTOMER-SPECIFIC VALUE:</strong> Turn what you learn into relevant value. Connect solutions to what the customer actually says matters—not generic features or assumptions.</li><li><strong>OBJECTIONS &amp; NEGOTIATION:</strong> Resolve the real concern while protecting value. Diagnose objections before responding, negotiate with discipline, and avoid unnecessary discounting.</li><li><strong>DECISION CLARITY &amp; FOLLOW-THROUGH:</strong> Move opportunities forward with purpose. Ask for the appropriate commitment, establish clear next steps, maintain momentum, and strengthen the relationship.</li></ul>'
    }
  },
  'PCL-SALES-OPS': {
    hero: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80',
    hours: 8,
    title: {
      es: 'Operaciones de Ventas y Optimización de Procesos',
      en: 'Sales Operations & Process Optimization'
    },
    summary: {
      es: 'Construye el sistema de ventas del que depende tu crecimiento. Crea la estructura, los procesos, la visibilidad y la responsabilidad necesarios para mejorar la ejecución, reducir la inconsistencia y lograr ingresos más predecibles.',
      en: 'Build the sales system your growth depends on. Create the structure, processes, visibility, and accountability needed to improve execution, reduce inconsistency, and drive more predictable revenue.'
    },
    summaryHtml: {
      es: '<p><strong>Construye el sistema de ventas del que depende tu crecimiento.</strong></p><p>Crea la estructura, los procesos, la visibilidad y la responsabilidad necesarios para mejorar la ejecución, reducir la inconsistencia y lograr ingresos más predecibles.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li><strong>FLUJO DE VENTAS Y CUELLOS DE BOTELLA:</strong> Haz visible el sistema de ventas. Mapea el camino del lead al resultado e identifica demoras, fugas, retrabajo y responsabilidades poco claras.</li><li><strong>DISCIPLINA DE ETAPAS Y CRM:</strong> Define las reglas con las que todos trabajan. Crea criterios de etapa claros, evidencia requerida, estándares de responsabilidad y prácticas de CRM que mejoren la visibilidad y la consistencia.</li><li><strong>MOVIMIENTO DEL PIPELINE Y SEGUIMIENTO:</strong> Mantén las oportunidades en movimiento con propósito. Establece estándares claros de respuesta, seguimiento, próxima acción y oportunidades estancadas que fortalezcan la disciplina del pipeline.</li><li><strong>PRONÓSTICO Y VISIBILIDAD DEL DESEMPEÑO:</strong> Gestiona con evidencia, no con optimismo. Usa la salud del pipeline, la lógica del pronóstico, tableros e indicadores significativos para tomar mejores decisiones comerciales.</li></ul>',
      en: '<p><strong>Build the sales system your growth depends on.</strong></p><p>Create the structure, processes, visibility, and accountability needed to improve execution, reduce inconsistency, and drive more predictable revenue.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li><strong>SALES FLOW &amp; BOTTLENECKS:</strong> Make the sales system visible. Map the path from lead to outcome and identify delays, leakage, rework, and unclear ownership.</li><li><strong>STAGE &amp; CRM DISCIPLINE:</strong> Define the rules everyone works from. Create clear stage criteria, required evidence, ownership standards, and CRM practices that improve visibility and consistency.</li><li><strong>PIPELINE MOVEMENT &amp; FOLLOW-UP:</strong> Keep opportunities moving with purpose. Establish clear response, follow-up, next-action, and stalled-opportunity standards that strengthen pipeline discipline.</li><li><strong>FORECASTING &amp; PERFORMANCE VISIBILITY:</strong> Manage by evidence—not optimism. Use pipeline health, forecast logic, dashboards, and meaningful indicators to make better commercial decisions.</li></ul>'
    }
  },
  'PCL-CX-SUCCESS': {
    hero: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=80',
    hours: 8,
    title: {
      es: 'Experiencia del Cliente y Éxito del Cliente',
      en: 'Customer Experience & Client Success'
    },
    summary: {
      es: 'Convierte la experiencia del cliente en un motor de ingresos. Desarrolla las capacidades para fortalecer relaciones, mejorar la retención, identificar oportunidades de upselling y cross-selling, y aumentar el valor del cliente en el tiempo.',
      en: 'Turn customer experience into a revenue engine. Build the capabilities to strengthen relationships, improve retention, identify upsell and cross-sell opportunities, and increase customer lifetime value.'
    },
    summaryHtml: {
      es: '<p><strong>Convierte la experiencia del cliente en un motor de ingresos.</strong></p><p>Desarrolla las capacidades para fortalecer relaciones, mejorar la retención, identificar oportunidades de upselling y cross-selling, y aumentar el valor del cliente en el tiempo.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li><strong>RECORRIDO DEL CLIENTE Y EXPECTATIVAS:</strong> Crea claridad desde el inicio. Reconoce los momentos que importan, alinea expectativas desde temprano y reduce la fricción a lo largo del recorrido del cliente.</li><li><strong>PERSONALIZACIÓN Y RESPONSABILIDAD:</strong> Haz que la experiencia sea relevante y con dueño. Usa el contexto del cliente, una comunicación clara y una responsabilidad firme para generar confianza y facilitar cada interacción.</li><li><strong>RECUPERACIÓN DEL SERVICIO Y RETENCIÓN:</strong> Resuelve el problema. Restaura la relación. Responde a los problemas con profesionalismo, reconstruye la confianza, reconoce señales de riesgo y haz seguimiento antes de que el cliente se desconecte.</li><li><strong>RENOVACIÓN Y CRECIMIENTO DE LA CUENTA:</strong> Crea crecimiento sin comprometer la confianza. Reconoce los momentos adecuados para renovaciones, referencias, upselling y cross-selling basados en una necesidad y un valor genuinos.</li></ul>',
      en: '<p><strong>Turn customer experience into a revenue engine.</strong></p><p>Build the capabilities to strengthen relationships, improve retention, identify upsell and cross-sell opportunities, and increase customer lifetime value.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li><strong>CUSTOMER JOURNEY &amp; EXPECTATIONS:</strong> Create clarity from the start. Recognize the moments that matter, align expectations early, and reduce friction across the customer journey.</li><li><strong>PERSONALIZATION &amp; OWNERSHIP:</strong> Make the experience feel relevant—and accountable. Use customer context, clear communication, and strong ownership to build confidence and make interactions easier.</li><li><strong>SERVICE RECOVERY &amp; RETENTION:</strong> Resolve the issue. Restore the relationship. Respond to problems professionally, rebuild trust, recognize risk signals, and follow up before customers disengage.</li><li><strong>RENEWAL &amp; ACCOUNT GROWTH:</strong> Create growth without compromising trust. Recognize the right moments for renewals, referrals, upselling, and cross-selling based on genuine customer need and value.</li></ul>'
    }
  },
  'PCL-CX-COMM': {
    hero: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=1400&q=80',
    hours: 6,
    title: {
      es: 'Comunicación e Influencia',
      en: 'Communication & Influence'
    },
    summary: {
      es: 'Haz que cada conversación crítica impulse el negocio. Fortalece la claridad, la confianza y la influencia necesarias para navegar conversaciones difíciles, generar alineación, acelerar decisiones y mejorar resultados.',
      en: 'Make every critical conversation move the business forward. Strengthen the clarity, confidence, and influence needed to navigate difficult conversations, build alignment, accelerate decisions, and improve outcomes.'
    },
    summaryHtml: {
      es: '<p><strong>Haz que cada conversación crítica impulse el negocio.</strong></p><p>Fortalece la claridad, la confianza y la influencia necesarias para navegar conversaciones difíciles, generar alineación, acelerar decisiones y mejorar resultados.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Hacer preguntas efectivas y escuchar lo que no se dice.</li><li>Responder con empatía, claridad y confianza profesional.</li><li>Explicar el valor sin presión ni lenguaje de guion.</li><li>Manejar interacciones difíciles protegiendo la relación.</li></ul>',
      en: '<p><strong>Make every critical conversation move the business forward.</strong></p><p>Strengthen the clarity, confidence, and influence needed to navigate difficult conversations, build alignment, accelerate decisions, and improve outcomes.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Ask effective questions and listen for what is not being said.</li><li>Respond with empathy, clarity, and professional confidence.</li><li>Explain value without pressure or scripted language.</li><li>Handle difficult interactions while protecting the relationship.</li></ul>'
    }
  },
  'PCL-LEAD-ELEAD': {
    hero: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1400&q=80',
    hours: 12,
    title: {
      es: 'Desarrollo de e-Liderazgo',
      en: 'e-Leadership Development'
    },
    summary: {
      es: 'La distancia cambia cómo trabajan los equipos. No debería debilitar cómo se lideran. Desarrolla líderes que generen claridad, responsabilidad, conexión y alto desempeño en equipos remotos, distribuidos e híbridos.',
      en: 'Distance changes how teams work. It shouldn\'t weaken how they\'re led. Develop leaders who create clarity, accountability, connection, and strong performance across remote, distributed, and hybrid teams.'
    },
    summaryHtml: {
      es: '<p><strong>La distancia cambia cómo trabajan los equipos. No debería debilitar cómo se lideran.</strong></p><p>Desarrolla líderes que generen claridad, responsabilidad, conexión y alto desempeño en equipos remotos, distribuidos e híbridos.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Definir resultados claros y delegar responsabilidades.</li><li>Conducir reuniones uno a uno y conversaciones de coaching con propósito.</li><li>Dar retroalimentación constructiva y abordar problemas de desempeño.</li><li>Crear acuerdos de comunicación y rutinas de liderazgo confiables.</li></ul>',
      en: '<p><strong>Distance changes how teams work. It shouldn\'t weaken how they\'re led.</strong></p><p>Develop leaders who create clarity, accountability, connection, and strong performance across remote, distributed, and hybrid teams.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Set clear outcomes and delegate responsibilities.</li><li>Run purposeful one-to-one meetings and coaching conversations.</li><li>Give constructive feedback and address performance concerns.</li><li>Create communication agreements and leadership routines teams can rely on.</li></ul>'
    }
  },
  'PCL-LEAD-TEAM': {
    hero: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1400&q=80',
    hours: 8,
    title: {
      es: 'Desempeño de Equipo y Cultura',
      en: 'Team Performance & Culture'
    },
    summary: {
      es: 'La cultura no es lo que dices. Es cómo se desempeña tu equipo. Convierte los valores en comportamientos cotidianos que fortalecen la colaboración, la responsabilidad, el compromiso y el desempeño consistente del equipo.',
      en: 'Culture isn\'t what you say. It\'s how your team performs. Turn values into everyday behaviors that strengthen collaboration, accountability, engagement, and consistent team performance.'
    },
    summaryHtml: {
      es: '<p><strong>La cultura no es lo que dices. Es cómo se desempeña tu equipo.</strong></p><p>Convierte los valores en comportamientos cotidianos que fortalecen la colaboración, la responsabilidad, el compromiso y el desempeño consistente del equipo.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Definir los comportamientos que sostienen las metas del equipo.</li><li>Construir seguridad psicológica sin bajar la exigencia.</li><li>Crear acuerdos operativos y prácticas de reconocimiento.</li><li>Fortalecer la colaboración entre sedes, horarios y funciones.</li></ul>',
      en: '<p><strong>Culture isn\'t what you say. It\'s how your team performs.</strong></p><p>Turn values into everyday behaviors that strengthen collaboration, accountability, engagement, and consistent team performance.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Define the behaviors that support the team\'s goals.</li><li>Build psychological safety without lowering accountability.</li><li>Create operating agreements and recognition practices.</li><li>Strengthen collaboration across locations, schedules, and functions.</li></ul>'
    }
  },
  'PCL-LEAD-CHANGE': {
    hero: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1400&q=80',
    hours: 8,
    title: {
      es: 'Liderar el cambio: de la resistencia a los resultados',
      en: 'Leading Change: From Resistance to Results'
    },
    summary: {
      es: 'El cambio solo crea valor cuando las personas lo adoptan. Prepara a los líderes para reducir la resistencia, construir preparación, acelerar la adopción y sostener el desempeño durante el cambio organizacional.',
      en: 'Change only creates value when people adopt it. Equip leaders to reduce resistance, build readiness, accelerate adoption, and sustain performance through organizational change.'
    },
    summaryHtml: {
      es: '<p><strong>El cambio solo crea valor cuando las personas lo adoptan.</strong></p><p>Prepara a los líderes para reducir la resistencia, construir preparación, acelerar la adopción y sostener el desempeño durante el cambio organizacional.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Evaluar las necesidades de los interesados y la preparación del personal.</li><li>Construir planes de comunicación, formación y adopción.</li><li>Clarificar responsabilidades y eliminar barreras de implementación.</li><li>Monitorear el avance y ajustar el enfoque con evidencia.</li></ul>',
      en: '<p><strong>Change only creates value when people adopt it.</strong></p><p>Equip leaders to reduce resistance, build readiness, accelerate adoption, and sustain performance through organizational change.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Assess stakeholder needs and employee readiness.</li><li>Build communication, training, and adoption plans.</li><li>Clarify responsibilities and remove implementation barriers.</li><li>Monitor progress and adjust the change approach using evidence.</li></ul>'
    }
  },
  'PCL-AI-EXEC': {
    hero: 'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1400&q=80',
    hours: 6,
    title: {
      es: 'De las metas a los resultados: ejecución de equipos potenciada por IA',
      en: 'From Goals to Results: AI-Powered Team Execution'
    },
    summary: {
      es: 'Las prioridades no generan resultados. La ejecución sí. Convierte las prioridades estratégicas en trabajo terminado con responsabilidad clara, flujos más inteligentes e IA práctica que ayuda a los equipos a avanzar más rápido y entregar más.',
      en: 'Priorities don\'t drive results. Execution does. Turn strategic priorities into completed work with clear accountability, smarter workflows, and practical AI that helps teams move faster and deliver more.'
    },
    summaryHtml: {
      es: '<p><strong>Las prioridades no generan resultados. La ejecución sí.</strong></p><p>Convierte las prioridades estratégicas en trabajo terminado con responsabilidad clara, flujos más inteligentes e IA práctica que ayuda a los equipos a avanzar más rápido y entregar más.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Usar la IA para reducir trabajo repetitivo y apoyar la ejecución.</li><li>Fijar prioridades y convertir metas en compromisos visibles.</li><li>Crear protocolos de reunión, puntos de control y responsabilidades de decisión.</li><li>Construir ritmos de trabajo que mejoren el foco, la coordinación y la responsabilidad.</li></ul>',
      en: '<p><strong>Priorities don\'t drive results. Execution does.</strong></p><p>Turn strategic priorities into completed work with clear accountability, smarter workflows, and practical AI that helps teams move faster and deliver more.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Use AI appropriately to reduce repetitive work and support execution.</li><li>Set priorities and convert goals into visible commitments.</li><li>Create meeting protocols, checkpoints, and decision responsibilities.</li><li>Build work rhythms that improve focus, coordination, and accountability.</li></ul>'
    }
  },
  'PCL-AI-WORK': {
    hero: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1400&q=80',
    hours: 8,
    title: {
      es: 'IA en el trabajo: herramientas prácticas para el desempeño del negocio',
      en: 'AI at Work: Practical Tools for Business Performance'
    },
    summary: {
      es: 'Lleva la IA de la experimentación al desempeño medible. Prepara a los equipos para usar la IA con responsabilidad, agilizar el trabajo, aumentar la productividad y crear valor medible en todas las funciones del negocio.',
      en: 'Move AI from experimentation to measurable performance. Equip teams to use AI responsibly to streamline work, increase productivity, and create measurable value across business functions.'
    },
    summaryHtml: {
      es: '<p><strong>Lleva la IA de la experimentación al desempeño medible.</strong></p><p>Prepara a los equipos para usar la IA con responsabilidad, agilizar el trabajo, aumentar la productividad y crear valor medible en todas las funciones del negocio.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Seleccionar usos responsables de IA conectados con prioridades del negocio.</li><li>Crear prompts y flujos reutilizables para el trabajo diario.</li><li>Revisar resultados apoyados en IA por precisión, calidad y riesgo.</li><li>Proteger los datos y alinear el uso de IA con la política organizacional.</li></ul>',
      en: '<p><strong>Move AI from experimentation to measurable performance.</strong></p><p>Equip teams to use AI responsibly to streamline work, increase productivity, and create measurable value across business functions.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Select responsible AI uses connected to business priorities.</li><li>Create reusable prompts and workflows for daily work.</li><li>Review AI-supported outputs for accuracy, quality, and risk.</li><li>Protect data and align AI use with organizational policy.</li></ul>'
    }
  },
  'PCL-AI-NETWORK': {
    hero: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1400&q=80',
    hours: 20,
    title: {
      es: 'Liderar el negocio como una sola red',
      en: 'Leading Business as One Network'
    },
    summary: {
      es: 'Distintas sedes. Un solo estándar de desempeño. Crea la alineación de liderazgo, la comunicación y la responsabilidad necesarias para operar con consistencia en sucursales, franquicias y unidades de negocio.',
      en: 'Different locations. One standard of performance. Create the leadership alignment, communication, and accountability needed to operate consistently across branches, franchises, and business units.'
    },
    summaryHtml: {
      es: '<p><strong>Distintas sedes. Un solo estándar de desempeño.</strong></p><p>Crea la alineación de liderazgo, la comunicación y la responsabilidad necesarias para operar con consistencia en sucursales, franquicias y unidades de negocio.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Derechos de decisión y roles de liderazgo claros.</li><li>Resultados y estándares compartidos con margen de adaptación local.</li><li>Rutinas de retroalimentación e intercambio de conocimiento en la red.</li></ul>',
      en: '<p><strong>Different locations. One standard of performance.</strong></p><p>Create the leadership alignment, communication, and accountability needed to operate consistently across branches, franchises, and business units.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>What should be standardized across the organization.</li><li>What should be adapted to local markets and customers.</li><li>Who has the authority to make which decisions.</li></ul>'
    }
  },
  'PCL-EDU-ASSESS': {
    hero: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80',
    hours: 16,
    title: {
      es: 'Más allá de la prueba anti-IA: evaluación para el aprendizaje auténtico',
      en: 'Beyond AI-Proofing: Assessment for Authentic Learning'
    },
    summary: {
      es: 'Cuando la IA puede producir la respuesta, la evaluación tiene que revelar el pensamiento. Rediseña la evaluación para que los educadores distingan un producto pulido con IA de la comprensión, el razonamiento, la aplicación y el dominio genuinos.',
      en: 'When AI can produce the answer, assessment has to reveal the thinking. Redesign assessment so educators can distinguish polished AI-assisted output from genuine understanding, reasoning, application, and mastery.'
    },
    summaryHtml: {
      es: '<p><strong>Cuando la IA puede producir la respuesta, la evaluación tiene que revelar el pensamiento.</strong></p><p>Rediseña la evaluación para que los educadores distingan un producto pulido con IA de la comprensión, el razonamiento, la aplicación y el dominio genuinos.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Evaluaciones rediseñadas listas para el aula.</li><li>Expectativas claras sobre el uso aceptable de IA.</li><li>Formas prácticas de verificar comprensión, revisión y transferencia.</li></ul>',
      en: '<p><strong>When AI can produce the answer, assessment has to reveal the thinking.</strong></p><p>Redesign assessment so educators can distinguish polished AI-assisted output from genuine understanding, reasoning, application, and mastery.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Redesigned assessments ready for classroom use.</li><li>Clear expectations for acceptable AI use.</li><li>Practical ways to verify understanding, revision, and transfer.</li></ul>'
    }
  },
  'PCL-EDU-NETWORK': {
    hero: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1400&q=80',
    hours: 20,
    title: {
      es: 'Liderar escuelas como una sola red de aprendizaje',
      en: 'Leading Schools as One Learning Network'
    },
    summary: {
      es: 'Distintas escuelas. Una dirección. Un solo estándar de aprendizaje. Construye la alineación de liderazgo, la comunicación y la responsabilidad necesarias para fortalecer el desempeño y la consistencia en escuelas, campus y redes de aprendizaje.',
      en: 'Different schools. One direction. One standard for learning. Build the leadership alignment, communication, and accountability needed to strengthen performance and consistency across schools, campuses, and learning networks.'
    },
    summaryHtml: {
      es: '<p><strong>Distintas escuelas. Una dirección. Un solo estándar de aprendizaje.</strong></p><p>Construye la alineación de liderazgo, la comunicación y la responsabilidad necesarias para fortalecer el desempeño y la consistencia en escuelas, campus y redes de aprendizaje.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Derechos de decisión y roles de liderazgo claros en toda la red.</li><li>Resultados y estándares compartidos con margen de adaptación local.</li><li>Rutinas de retroalimentación e intercambio entre escuelas o unidades.</li></ul>',
      en: '<p><strong>Different schools. One direction. One standard for learning.</strong></p><p>Build the leadership alignment, communication, and accountability needed to strengthen performance and consistency across schools, campuses, and learning networks.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Clear decision rights and leadership roles across the network.</li><li>Shared outcomes and standards with room for local adaptation.</li><li>Feedback and knowledge-sharing routines between schools or units.</li></ul>'
    }
  },
  'PCL-EDU-WALK': {
    hero: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1400&q=80',
    hours: 16,
    title: {
      es: 'El recorrido instruccional con IA',
      en: 'The AI Instructional Walkthrough'
    },
    summary: {
      es: 'No busques solo el uso de IA. Busca evidencia de aprendizaje. Prepara a los líderes instruccionales para evaluar cómo se usa la IA, identificar el aprendizaje auténtico, proteger el rigor académico y orientar mejores prácticas docentes.',
      en: 'Don\'t just look for AI use. Look for evidence of learning. Equip instructional leaders to evaluate how AI is being used, identify authentic learning, protect academic rigor, and guide stronger teaching practices.'
    },
    summaryHtml: {
      es: '<p><strong>No busques solo el uso de IA. Busca evidencia de aprendizaje.</strong></p><p>Prepara a los líderes instruccionales para evaluar cómo se usa la IA, identificar el aprendizaje auténtico, proteger el rigor académico y orientar mejores prácticas docentes.</p><p><strong>Lo que aprenderás y practicarás</strong></p><ul><li>Distinguir el uso productivo de IA del trabajo que oculta comprensión débil.</li><li>Calibrar un proceso de recorrido conciso entre equipos de liderazgo.</li><li>Usar la evidencia para guiar el coaching, no el cumplimiento.</li><li>Identificar dónde la IA fortalece el aprendizaje y dónde puede debilitarlo.</li></ul>',
      en: '<p><strong>Don\'t just look for AI use. Look for evidence of learning.</strong></p><p>Equip instructional leaders to evaluate how AI is being used, identify authentic learning, protect academic rigor, and guide stronger teaching practices.</p><p><strong>What you\'ll learn and practice</strong></p><ul><li>Distinguish productive AI use from work that hides weak understanding.</li><li>Calibrate a concise walkthrough process across leadership teams.</li><li>Use evidence to guide coaching rather than compliance.</li><li>Identify where AI strengthens learning and where it may weaken it.</li></ul>'
    }
  }
};

export function peregrineProgram(shortname: string | undefined | null): PeregrineProgram | undefined {
  if (!shortname) {
    return undefined;
  }
  return PEREGRINE_CATALOG[shortname.trim().toUpperCase()];
}
