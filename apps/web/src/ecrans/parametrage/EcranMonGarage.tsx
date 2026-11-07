import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LegendeChampsObligatoires } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useBlocCreancier } from '@/hooks/parametrage/useBlocCreancier';

import { adresseGarageComplete, FormulaireAdresseGarage } from './FormulaireAdresseGarage';
import { SectionEntreprise } from './SectionEntreprise';
import { SectionSignalements } from './SectionSignalements';

/**
 * « Mon garage » : ce qui identifie le garage sur ses factures et documents — nom (raison sociale),
 * logo, TVA, délai de paiement (`SectionEntreprise`) et adresse (bloc créancier, partie adresse).
 * Les comptes bancaires restent dans « Facturation ».
 *
 * Bandeau « À compléter » en tête d'écran (pas dans la barre latérale) : forme + icône + mot, il
 * liste ce qui bloquerait l'émission d'une QR-facture. Il ne s'affiche qu'une fois l'adresse lue :
 * « inconnu » (chargement, refus de droit) n'est jamais présenté comme « incomplet ».
 *
 * EMPLACEMENT DE LA QUESTION « ASSUJETTI À LA TVA ? » : dans `SectionEntreprise`, juste avant le
 * champ « Numéro de TVA » (c'est là que la branche `feat/assujetti-tva` l'ajoute). Ne pas la
 * dupliquer ici.
 */
export function EcranMonGarage() {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  const bloc = useBlocCreancier();
  const adresseIncomplete = bloc.isSuccess && !adresseGarageComplete(bloc.data);

  return (
    <GabaritEcran titre={t('parametrage:garage.titre')}>
      <div className="flex flex-col gap-6">
        <LegendeChampsObligatoires>
          {t('parametrage:obligatoire.legende')}
        </LegendeChampsObligatoires>

        {adresseIncomplete ? (
          <Alert variant="avertissement">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>{t('parametrage:garage.aCompleter.titre')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                <li>{t('parametrage:garage.aCompleter.adresse')}</li>
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <SectionEntreprise />

        <SectionSignalements />

        {bloc.isPending ? (
          <EtatChargement lignes={5} />
        ) : bloc.isError ? (
          <EtatErreur
            titre={t('parametrage:creancier.erreur.titre')}
            description={messageErreur(bloc.error, t)}
            onReessayer={() => void bloc.refetch()}
          />
        ) : (
          <FormulaireAdresseGarage blocCreancier={bloc.data} />
        )}
      </div>
    </GabaritEcran>
  );
}
