import { Car } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseVehiculeCourtoisie } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { DialogueNouveauPret } from '@/ecrans/courtoisie/DialogueNouveauPret';
import { bornesDuJour, jourLocal } from '@/ecrans/courtoisie/periode';
import { useVehiculesCourtoisie } from '@/hooks/courtoisie/useCourtoisie';

interface Props {
  readonly orId: string;
  readonly clientId: string;
}

/**
 * Raccourci « Véhicule de courtoisie » de la fiche OR : choisir une voiture libre aujourd'hui, puis
 * le dialogue de prêt s'ouvre avec le client et l'OR déjà renseignés (plus de ressaisie depuis
 * l'écran Courtoisie).
 */
export function BoutonVehiculeCourtoisieOr({ orId, clientId }: Props) {
  const { t } = useTranslation(['or', 'courtoisie', 'commun', 'erreurs']);
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [aPreter, setAPreter] = useState<ReponseVehiculeCourtoisie | null>(null);
  const jour = jourLocal(new Date());

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setChoixOuvert(true)}>
        <Car aria-hidden className="h-4 w-4" />
        {t('or:courtoisie.action')}
      </Button>

      <Dialog open={choixOuvert} onOpenChange={setChoixOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('or:courtoisie.titre')}</DialogTitle>
            <DialogDescription>{t('or:courtoisie.description')}</DialogDescription>
          </DialogHeader>
          <ChoixVehiculeLibre
            jour={jour}
            onChoisir={(vehicule) => {
              setAPreter(vehicule);
              setChoixOuvert(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <DialogueNouveauPret
        key={aPreter?.id ?? 'aucun'}
        vehicule={aPreter}
        jour={jour}
        clientIdInitial={clientId}
        ordreReparationId={orId}
        onFermer={() => setAPreter(null)}
      />
    </>
  );
}

/** Monté seulement dialogue ouvert : le parc n'est chargé qu'à la demande. */
function ChoixVehiculeLibre({
  jour,
  onChoisir,
}: {
  readonly jour: string;
  readonly onChoisir: (vehicule: ReponseVehiculeCourtoisie) => void;
}) {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const { du, au } = bornesDuJour(jour);
  const requete = useVehiculesCourtoisie(du, au);
  const libres = (requete.data?.vehicules ?? []).filter((v) => v.disponibilite === 'libre');

  return (
    <>
      {requete.isPending ? (
        <EtatChargement lignes={3} />
      ) : requete.isError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="texte-corps text-destructive">
            {messageErreur(requete.error, t)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void requete.refetch()}
          >
            {t('commun:actions.reessayer')}
          </Button>
        </div>
      ) : libres.length === 0 ? (
        <p className="texte-corps text-muted-foreground">{t('or:courtoisie.aucunLibre')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {libres.map((vehicule) => (
            <li key={vehicule.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between py-2"
                onClick={() => onChoisir(vehicule)}
              >
                <span>{vehicule.designation}</span>
                {vehicule.plaque ? (
                  <span className="font-mono text-muted-foreground">{vehicule.plaque}</span>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
