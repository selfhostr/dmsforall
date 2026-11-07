import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { SAISONS_PNEU, type SaisonPneu, type VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
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
import { useCreerDepotPneus } from '@/hooks/pneus/useCreerDepotPneus';

import { SelecteurVehiculePourDepot } from './composants/SelecteurVehiculePourDepot';

interface Props {
  readonly siteId: string | undefined;
  readonly ouvert: boolean;
  readonly onFerme: () => void;
}

/** `POST /vehicules/{id}/depots-pneus` (RPP-01/RPP-02) — entrée d'un nouveau jeu dans le hangar du
 *  site COURANT (`siteId` fixé par l'écran appelant, jamais ressaisi ici : ce dialogue entre un
 *  jeu dans LE hangar qu'on regarde). `dimension` est laissée vide par défaut — le serveur la
 *  recopie depuis `vehicule.pneusEte`/`pneusHiver` si omise (voir le contrat), l'indication sous
 *  le champ le dit explicitement plutôt que de forcer une ressaisie. */
export function DialogueNouveauDepotPneu({ siteId, ouvert, onFerme }: Props) {
  const { t } = useTranslation(['pneus', 'commun', 'validation']);
  const creer = useCreerDepotPneus();
  const idempotence = useCleIdempotence();

  const [vehicule, setVehicule] = useState<VehiculeResume | null>(null);
  const [saison, setSaison] = useState<SaisonPneu>('ete');
  const [codeCase, setCodeCase] = useState('');
  const [dimension, setDimension] = useState('');
  const [etat, setEtat] = useState('');

  useEffect(() => {
    if (!ouvert) {
      setVehicule(null);
      setSaison('ete');
      setCodeCase('');
      setDimension('');
      setEtat('');
      creer.reset();
      idempotence.regenerer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réinitialisation à la fermeture seulement
  }, [ouvert]);

  const formulaireValide = vehicule !== null && siteId !== undefined;

  function soumettre(evenement?: FormEvent) {
    evenement?.preventDefault();
    if (!formulaireValide || !vehicule || !siteId) return;
    creer.mutate(
      {
        vehiculeId: vehicule.id,
        entree: {
          siteId,
          saison,
          codeCase: codeCase.trim() === '' ? undefined : codeCase.trim(),
          dimension: dimension.trim() === '' ? undefined : dimension.trim(),
          etat: etat.trim() === '' ? undefined : etat.trim(),
        },
        idempotencyKey: idempotence.cle,
      },
      {
        onSuccess: () => {
          idempotence.regenerer();
          onFerme();
        },
      },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={(valeurOuverte) => !valeurOuverte && onFerme()}
      titre={t('pneus:creation.titre')}
      pied={
        <>
          <Button type="button" variant="outline" onClick={onFerme} disabled={creer.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="submit"
            form="formulaire-nouveau-depot-pneu"
            disabled={!formulaireValide || creer.isPending}
          >
            {creer.isPending ? t('commun:chargement.enCours') : t('pneus:creation.actions.creer')}
          </Button>
        </>
      }
    >
      <form id="formulaire-nouveau-depot-pneu" onSubmit={soumettre} className="flex flex-col gap-4">
        <SelecteurVehiculePourDepot valeur={vehicule?.id ?? null} onChangeValeur={setVehicule} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-saison">{t('pneus:creation.champSaison')} *</Label>
          <Select value={saison} onValueChange={(v) => setSaison(v as SaisonPneu)}>
            <SelectTrigger id="depot-pneu-saison">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAISONS_PNEU.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pneus:saison.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-code-case">{t('pneus:creation.champCodeCase')}</Label>
          <Input
            id="depot-pneu-code-case"
            value={codeCase}
            maxLength={60}
            placeholder={t('pneus:creation.champCodeCasePlaceholder')}
            onChange={(evenement) => setCodeCase(evenement.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-dimension">{t('pneus:creation.champDimension')}</Label>
          <Input
            id="depot-pneu-dimension"
            value={dimension}
            maxLength={60}
            placeholder={t('pneus:creation.champDimensionPlaceholder')}
            onChange={(evenement) => setDimension(evenement.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-etat">{t('pneus:creation.champEtat')}</Label>
          <Textarea
            id="depot-pneu-etat"
            value={etat}
            maxLength={500}
            onChange={(evenement) => setEtat(evenement.target.value)}
          />
        </div>
        {creer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(creer.error, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
