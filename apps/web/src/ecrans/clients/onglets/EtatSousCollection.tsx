import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

interface Props {
  readonly enChargement: boolean;
  readonly erreur: unknown;
  readonly onReessayer: () => void;
  readonly vide: boolean;
  readonly texteVide: string;
  readonly children: ReactNode;
}

/** Les trois états (chargement/vide/erreur) communs aux cinq onglets de sous-collection de la
 *  fiche — factorisés une fois pour ne pas les réécrire cinq fois à l'identique. Le corps réel
 *  (`children`, la liste + le formulaire d'ajout) reste propre à chaque onglet. */
export function EtatSousCollection({
  enChargement,
  erreur,
  onReessayer,
  vide,
  texteVide,
  children,
}: Props) {
  const { t } = useTranslation('erreurs');

  if (enChargement) return <EtatChargement lignes={2} />;

  if (erreur) {
    const estErreurReseau = erreur instanceof ErreurReseau;
    return (
      <EtatErreur
        titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
        description={messageErreur(erreur, t)}
        onReessayer={onReessayer}
      />
    );
  }

  if (vide) return <p className="texte-corps text-muted-foreground">{texteVide}</p>;

  return <>{children}</>;
}
