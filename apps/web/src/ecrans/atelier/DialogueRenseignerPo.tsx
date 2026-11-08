import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { useRenseignerPoOr } from '@/hooks/atelier/useRenseignerPoOr';

import { messagesErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly orId: string;
  /** `ReponseOrdreReparation.version`, pour l'`If-Match` du `PATCH`. */
  readonly version: number;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly onEnregistre?: () => void;
}

/** « Renseigner le n° de bon de commande du client » (action proposée `RENSEIGNER_PO`, RM-14). */
export function DialogueRenseignerPo({
  orId,
  version,
  ouvert,
  onOuvertChange,
  onEnregistre,
}: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const mutation = useRenseignerPoOr(orId);
  const [numero, setNumero] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  function fermer(valeur: boolean) {
    if (!valeur) {
      mutation.reset();
      setErreur(null);
    }
    onOuvertChange(valeur);
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={fermer}
      titre={t('or:renseignerPo.titre')}
      pied={
        <>
          <Button type="button" variant="outline" onClick={() => fermer(false)}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="or-po-formulaire" enChargement={mutation.isPending}>
            {t('or:actions.confirmer')}
          </Button>
        </>
      }
    >
      <form
        id="or-po-formulaire"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          if (numero.trim() === '') {
            setErreur(t('or:renseignerPo.requis'));
            return;
          }
          setErreur(null);
          mutation.mutate(
            { numeroCommandeInterne: numero, version },
            {
              onSuccess: () => {
                setNumero('');
                onOuvertChange(false);
                onEnregistre?.();
              },
            },
          );
        }}
      >
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="or-po-numero" requis>
            {t('or:bandeau.numeroPo')}
          </Label>
          <Input
            id="or-po-numero"
            value={numero}
            maxLength={60}
            aria-required="true"
            onChange={(evenement) => setNumero(evenement.target.value)}
          />
          {erreur ? <p className="texte-libelle text-destructive">{erreur}</p> : null}
        </div>
        {mutation.isError
          ? messagesErreurMutation(mutation.error, t).map((message, index) => (
              <p key={index} role="alert" className="texte-libelle text-destructive">
                {message}
              </p>
            ))
          : null}
      </form>
    </PanneauLateral>
  );
}
