import { peut } from '@/droits';
import { useEtapesDemarrage } from '@/hooks/accueil/useEtapesDemarrage';
import { useSession } from '@/hooks/useSession';

import { useFermetureAssistant } from './useFermetureAssistant';

/**
 * Faut-il rappeler qu'il reste à configurer le garage ? Oui seulement pour qui gère les
 * paramètres, quand l'assistant a été fermé et que l'état réel du démarrage (répondu, sans
 * « inconnu ») dit que le garage n'est pas configuré. Le rappel disparaît tout seul une fois
 * configuré. L'état de démarrage n'est interrogé qu'une fois l'assistant fermé.
 */
export function usePastilleAssistant(): boolean {
  const { data: session } = useSession();
  const autorise = peut(session?.actions, 'parametrage.atelier.modifier');
  const { ferme } = useFermetureAssistant(session?.tenant.id, session?.utilisateur.id);
  const { etapes, complet, enChargement } = useEtapesDemarrage(autorise && ferme);
  if (!autorise || !ferme || enChargement) return false;
  if (etapes.some((e) => e.etat === 'inconnu')) return false;
  return !complet;
}
