import { useTranslation } from 'react-i18next';

import { useClient } from '@/hooks/clients/useClient';

interface Props {
  readonly clientId: string;
}

/**
 * Résout le nom d'affichage d'un organisme de dette de financement résiduelle référencé par ID
 * (`ReponseReprise.detteFinancementOrganismeId`).
 *
 * ÉCART SIGNALÉ (contrat `contrats/ventes/reprise.ts`) : contrairement à
 * `ReponseFinancement.organisme` (un `ClientResume` complet), la reprise n'expose que l'ID brut —
 * aucun `nomAffiche` n'est embarqué. Ce composant fait un second aller-retour (`GET /clients/{id}`,
 * hook déjà existant `useClient`) plutôt que d'afficher un UUID au garagiste ; une prochaine
 * révision du contrat pourrait embarquer un `ClientResume` directement, comme `financement.ts`,
 * et éviter ce second appel — signalé dans le rapport de livraison, pas corrigé ici (contrat gelé,
 * hors périmètre d'écriture de cet agent).
 */
export function NomOrganismeDette({ clientId }: Props) {
  const { t } = useTranslation('commun');
  const requete = useClient(clientId);

  if (requete.isLoading) {
    return <span className="text-muted-foreground">{t('commun:chargement.enCours')}</span>;
  }
  if (requete.isError || !requete.data) {
    return <span className="font-mono text-muted-foreground">{clientId}</span>;
  }
  return <span>{requete.data.nomAffiche}</span>;
}
