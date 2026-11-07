import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseMotifRendezVous } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreerMotifRendezVous,
  useModifierMotifRendezVous,
} from '@/hooks/parametrage/useMotifsRendezVousGestion';

import {
  centiemesVersHeures,
  construireCreation,
  construireModification,
  type ChampMotifRendezVous,
  type SaisieMotifRendezVous,
} from './motifs-rdv';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Absent = création. */
  readonly motif?: ReponseMotifRendezVous;
}

function saisieInitiale(motif: ReponseMotifRendezVous | undefined): SaisieMotifRendezVous {
  return {
    libelleFr: motif?.libelleFr ?? '',
    libelleDe: motif?.libelleDe ?? '',
    libelleIt: motif?.libelleIt ?? '',
    dureeMinutes:
      motif?.dureeDefautMinutes === null || !motif ? '' : String(motif.dureeDefautMinutes),
    heuresAtelier: centiemesVersHeures(motif?.heuresAtelierDefautCentiemes ?? null),
  };
}

/**
 * Le dialogue est remonté à chaque ouverture (`key` posée par l'appelant) : la saisie repart
 * toujours de l'état du motif, et reste intacte en cas d'erreur serveur (jamais de perte de
 * saisie).
 */
export function DialogueMotifRendezVous({ ouvert, onOuvertChange, motif }: Props) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const creer = useCreerMotifRendezVous();
  const modifier = useModifierMotifRendezVous();
  const estModification = motif !== undefined;
  const enCours = creer.isPending || modifier.isPending;

  const [saisie, setSaisie] = useState<SaisieMotifRendezVous>(() => saisieInitiale(motif));
  const [champEnErreur, setChampEnErreur] = useState<ChampMotifRendezVous | undefined>(undefined);

  function maj(champ: keyof SaisieMotifRendezVous, valeur: string) {
    setSaisie((precedente) => ({ ...precedente, [champ]: valeur }));
    setChampEnErreur(undefined);
    creer.reset();
    modifier.reset();
  }

  function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (motif) {
      const resultat = construireModification(saisie);
      if (!resultat.ok) return setChampEnErreur(resultat.champ);
      modifier.mutate(
        { id: motif.id, entree: resultat.entree },
        { onSuccess: () => onOuvertChange(false) },
      );
      return;
    }
    const resultat = construireCreation(saisie);
    if (!resultat.ok) return setChampEnErreur(resultat.champ);
    creer.mutate(resultat.entree, { onSuccess: () => onOuvertChange(false) });
  }

  const erreurServeur = estModification ? modifier.error : creer.error;
  const dejaPris = erreurServeur instanceof ErreurApi && erreurServeur.probleme.code === 'CONFLIT';

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {estModification
              ? t('parametrage:motifsRdv.modifier')
              : t('parametrage:motifsRdv.nouveau')}
          </DialogTitle>
          <DialogDescription>{t('parametrage:motifsRdv.dialogueAide')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mrv-libelle-fr">{t('parametrage:motifsRdv.champs.libelleFr')}</Label>
            <Input
              id="mrv-libelle-fr"
              value={saisie.libelleFr}
              maxLength={200}
              readOnly={enCours}
              aria-invalid={champEnErreur === 'libelleFr' || dejaPris ? true : undefined}
              aria-describedby={
                champEnErreur === 'libelleFr' || dejaPris ? 'mrv-libelle-fr-erreur' : undefined
              }
              onChange={(e) => maj('libelleFr', e.target.value)}
            />
            {champEnErreur === 'libelleFr' ? (
              <p id="mrv-libelle-fr-erreur" className="texte-libelle text-destructive">
                {t('parametrage:motifsRdv.erreurs.libelle')}
              </p>
            ) : null}
            {dejaPris ? (
              <p id="mrv-libelle-fr-erreur" className="texte-libelle text-destructive">
                {t('parametrage:motifsRdv.erreurs.dejaPris')}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mrv-libelle-de">{t('parametrage:motifsRdv.champs.libelleDe')}</Label>
              <Input
                id="mrv-libelle-de"
                value={saisie.libelleDe}
                maxLength={200}
                readOnly={enCours}
                onChange={(e) => maj('libelleDe', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mrv-libelle-it">{t('parametrage:motifsRdv.champs.libelleIt')}</Label>
              <Input
                id="mrv-libelle-it"
                value={saisie.libelleIt}
                maxLength={200}
                readOnly={enCours}
                onChange={(e) => maj('libelleIt', e.target.value)}
              />
            </div>
          </div>
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:motifsRdv.traductionsAide')}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mrv-duree">{t('parametrage:motifsRdv.champs.dureeMinutes')}</Label>
              <Input
                id="mrv-duree"
                inputMode="numeric"
                value={saisie.dureeMinutes}
                readOnly={enCours}
                aria-invalid={champEnErreur === 'dureeMinutes' ? true : undefined}
                aria-describedby="mrv-duree-aide"
                onChange={(e) => maj('dureeMinutes', e.target.value)}
              />
              <p
                id="mrv-duree-aide"
                className={
                  champEnErreur === 'dureeMinutes'
                    ? 'texte-libelle text-destructive'
                    : 'texte-libelle text-muted-foreground'
                }
              >
                {champEnErreur === 'dureeMinutes'
                  ? t('parametrage:motifsRdv.erreurs.duree')
                  : t('parametrage:motifsRdv.champs.dureeMinutesAide')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mrv-heures">{t('parametrage:motifsRdv.champs.heuresAtelier')}</Label>
              <Input
                id="mrv-heures"
                inputMode="decimal"
                value={saisie.heuresAtelier}
                readOnly={enCours}
                aria-invalid={champEnErreur === 'heuresAtelier' ? true : undefined}
                aria-describedby="mrv-heures-aide"
                onChange={(e) => maj('heuresAtelier', e.target.value)}
              />
              <p
                id="mrv-heures-aide"
                className={
                  champEnErreur === 'heuresAtelier'
                    ? 'texte-libelle text-destructive'
                    : 'texte-libelle text-muted-foreground'
                }
              >
                {champEnErreur === 'heuresAtelier'
                  ? t('parametrage:motifsRdv.erreurs.heures')
                  : t('parametrage:motifsRdv.champs.heuresAtelierAide')}
              </p>
            </div>
          </div>

          {erreurServeur && !dejaPris ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(erreurServeur, t)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOuvertChange(false)}
              disabled={enCours}
            >
              {t('commun:actions.annuler')}
            </Button>
            <Button type="submit" disabled={enCours}>
              {enCours ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
