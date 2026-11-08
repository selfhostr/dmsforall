import { FilePlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClientResume } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { BoutonIconeInfobulle } from '@/composants/commun/BoutonIconeInfobulle';
import { useSession } from '@/hooks/useSession';

import { DialogueNouveauDevis } from './DialogueNouveauDevis';
import { peutCreerDevis } from './droits';

interface Props {
  /** Client connu d'avance (fiche client) ; absent depuis la liste Facturation. */
  readonly client?: Pick<ClientResume, 'id' | 'nomAffiche'>;
  /** Véhicule connu d'avance (fiche véhicule) : préselectionné dans le dialogue. */
  readonly vehiculeId?: string;
  readonly variante?: 'default' | 'outline';
  /** Bouton carré « + » sans texte, avec infobulle : pour la barre de filtres d'une liste. */
  readonly iconeSeule?: boolean;
}

/** Entrée « Nouveau devis » — masquée aux rôles sans droit de créer un brouillon de vente. */
export function BoutonNouveauDevis({ client, vehiculeId, variante = 'outline', iconeSeule = false }: Props) {
  const { t } = useTranslation('facturation');
  const session = useSession();
  const [ouvert, setOuvert] = useState(false);

  if (!peutCreerDevis(session.data?.actions)) return null;

  return (
    <>
      {iconeSeule ? (
        <BoutonIconeInfobulle
          libelle={t('devis.nouveau.action')}
          icone={Plus}
          onClick={() => setOuvert(true)}
        />
      ) : (
        <Button type="button" variant={variante} onClick={() => setOuvert(true)}>
          <FilePlus aria-hidden className="h-4 w-4" />
          {t('devis.nouveau.action')}
        </Button>
      )}
      <DialogueNouveauDevis
        ouvert={ouvert}
        onOuvertChange={setOuvert}
        client={client}
        vehiculeIdInitial={vehiculeId}
      />
    </>
  );
}
