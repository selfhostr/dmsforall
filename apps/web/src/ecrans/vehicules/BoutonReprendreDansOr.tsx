import { useTranslation } from 'react-i18next';

import type { ReponseTravailReporte } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { useReprendreTravailDansOr } from '@/hooks/vehicules/useReprendreTravailDansOr';

/** Un OR sur lequel on peut encore poser des lignes (ni terminé, ni facturé, ni clos). */
const STATUTS_OR_FERMES: ReadonlySet<string> = new Set([
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule',
]);

interface Props {
  readonly vehiculeId: string;
  readonly travail: ReponseTravailReporte;
}

/**
 * « Reprendre dans cet OR » depuis la fiche véhicule : un seul OR ouvert -> un clic ; plusieurs ->
 * on choisit lequel ; aucun -> rien à proposer ici (le bouton « Nouvel OR » de la fiche reste la
 * voie). La ligne est créée sur l'OR puis le travail passe à « repris ».
 */
export function BoutonReprendreDansOr({ vehiculeId, travail }: Props) {
  const { t } = useTranslation(['vehicules', 'erreurs']);
  const contexte = useContexteAtelier(vehiculeId);
  const reprise = useReprendreTravailDansOr(vehiculeId);

  const ors = (contexte.data?.ordresReparationOuverts ?? []).filter(
    (or) => !STATUTS_OR_FERMES.has(or.statut),
  );
  if (ors.length === 0) return null;

  const erreur = reprise.isError ? (
    <p role="alert" className="texte-libelle text-destructive">
      {messageErreur(reprise.error, t)}
    </p>
  ) : null;

  const premier = ors[0];
  if (ors.length === 1 && premier) {
    return (
      <>
        {erreur}
        <Button
          type="button"
          size="sm"
          disabled={reprise.isPending}
          onClick={() => reprise.mutate({ travail, orId: premier.id })}
        >
          {t('vehicules:travauxReportes.actions.reprendreDansOr', { numero: premier.numero })}
        </Button>
      </>
    );
  }

  return (
    <>
      {erreur}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" disabled={reprise.isPending}>
            {t('vehicules:travauxReportes.actions.reprendreDansUnOr')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ors.map((or) => (
            <DropdownMenuItem key={or.id} onSelect={() => reprise.mutate({ travail, orId: or.id })}>
              {or.numero}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
