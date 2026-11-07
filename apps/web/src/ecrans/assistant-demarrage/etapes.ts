/** Identifiants stables des étapes : servent de clés i18n (`assistant:etapes.<id>`). */
export const ETAPES_ASSISTANT = [
  'garage',
  'modules',
  'paiements',
  'atelier',
  'logo',
  'equipe',
  'termine',
] as const;
export type IdEtapeAssistant = (typeof ETAPES_ASSISTANT)[number];

/** Seule la première étape est obligatoire ; les autres se passent d'un geste. */
export function etapePassable(id: IdEtapeAssistant): boolean {
  return id !== 'garage' && id !== 'termine';
}

export function etapeSuivante(id: IdEtapeAssistant): IdEtapeAssistant {
  const i = ETAPES_ASSISTANT.indexOf(id);
  return ETAPES_ASSISTANT[Math.min(i + 1, ETAPES_ASSISTANT.length - 1)] as IdEtapeAssistant;
}

export function etapePrecedente(id: IdEtapeAssistant): IdEtapeAssistant {
  const i = ETAPES_ASSISTANT.indexOf(id);
  return ETAPES_ASSISTANT[Math.max(i - 1, 0)] as IdEtapeAssistant;
}
