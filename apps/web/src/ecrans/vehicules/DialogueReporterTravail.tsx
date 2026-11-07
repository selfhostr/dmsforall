import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaCreationTravailReporte, URGENCES_TRAVAIL, type UrgenceTravail } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PanneauLateral } from '@/composants/PanneauLateral';

import { useCreerTravailReporte } from './useCreerTravailReporte';

const CLES_URGENCE: Record<UrgenceTravail, string> = {
  urgent: 'urgent',
  a_faire: 'aFaire',
  a_surveiller: 'aSurveiller',
};

interface Props {
  readonly vehiculeId: string;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** OR d'où vient la remarque (facultatif ; absent = saisie libre depuis la fiche véhicule). */
  readonly ordreReparationOrigineId?: string;
  /** Pré-remplissage (« Reporter ce travail » depuis une ligne d'OR) : lu à l'ouverture seulement,
   *  l'appelant remonte le dialogue (`key`) pour une autre ligne. */
  readonly valeursInitiales?: {
    readonly designation: string;
    readonly detail?: string | null;
    readonly urgence?: UrgenceTravail | null;
    readonly securite?: boolean;
  };
}

/** « Reporter un travail » : le mécanicien note ce qui sera à faire à la prochaine visite. */
export function DialogueReporterTravail({
  vehiculeId,
  ouvert,
  onOuvertChange,
  ordreReparationOrigineId,
  valeursInitiales,
}: Props) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs']);
  const creer = useCreerTravailReporte(vehiculeId);
  const [designation, setDesignation] = useState(valeursInitiales?.designation ?? '');
  const [detail, setDetail] = useState(valeursInitiales?.detail ?? '');
  const [urgence, setUrgence] = useState<UrgenceTravail>(valeursInitiales?.urgence ?? 'a_faire');
  const [erreur, setErreur] = useState<string | null>(null);

  function changerOuvert(valeur: boolean) {
    if (!valeur) {
      setDesignation('');
      setDetail('');
      setUrgence('a_faire');
      setErreur(null);
      creer.reset();
    }
    onOuvertChange(valeur);
  }

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    const resultat = schemaCreationTravailReporte.safeParse({
      designation,
      detail: detail.trim() === '' ? undefined : detail,
      urgence,
      securite: valeursInitiales?.securite ? true : undefined,
      ordreReparationOrigineId,
    });
    if (!resultat.success) {
      setErreur(t('vehicules:travauxReportes.reporter.erreurValidation'));
      return;
    }
    setErreur(null);
    creer.mutate(resultat.data, { onSuccess: () => changerOuvert(false) });
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={changerOuvert}
      titre={t('vehicules:travauxReportes.reporter.titre')}
      pied={
        <>
          <Button type="button" variant="outline" onClick={() => changerOuvert(false)}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="formulaire-reporter-travail" disabled={creer.isPending}>
            {t('vehicules:travauxReportes.reporter.enregistrer')}
          </Button>
        </>
      }
    >
      <form id="formulaire-reporter-travail" onSubmit={soumettre} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reporter-designation">
            {t('vehicules:travauxReportes.dialogue.designation')}
          </Label>
          <Input
            id="reporter-designation"
            value={designation}
            maxLength={200}
            required
            placeholder={t('vehicules:travauxReportes.reporter.designationPlaceholder')}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reporter-detail">{t('vehicules:travauxReportes.reporter.detail')}</Label>
          <Textarea
            id="reporter-detail"
            value={detail}
            maxLength={4000}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reporter-urgence">{t('vehicules:travauxReportes.urgence')}</Label>
          <Select value={urgence} onValueChange={(v) => setUrgence(v as UrgenceTravail)}>
            <SelectTrigger id="reporter-urgence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {URGENCES_TRAVAIL.map((u) => (
                <SelectItem key={u} value={u}>
                  {t(`vehicules:travauxReportes.urgences.${CLES_URGENCE[u]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {erreur || creer.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{erreur ?? messageErreur(creer.error, t)}</AlertDescription>
          </Alert>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
