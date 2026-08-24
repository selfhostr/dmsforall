import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModifierEmplacementVehicule } from '@/hooks/vehicules/useModifierEmplacementVehicule';
import { formaterDateHeure } from '@/lib/formats';
import { cn } from '@/lib/utils';

const LONGUEUR_MAX_EMPLACEMENT = 60;

export interface ProprietesChampEmplacementVehicule {
  readonly vehiculeId: string;
  readonly emplacement: string | null;
  /** `null` autant quand l'emplacement n'a jamais été noté que quand il l'a été puis effacé —
   *  aucune ambiguïté à lever ici : dans les deux cas, rien à afficher. */
  readonly majLe: string | null;
  /** `PATCH /vehicules/{id}` exige `vehicule.modifier`, que `technicien`/`comptable`/`vendeur`/
   *  `poste_atelier` n'ont PAS (lecture seule, voir `ecrans/vehicules/droits.ts`). Calculé par
   *  l'APPELANT (`EnTeteFicheVehicule`, depuis la session) plutôt qu'ici : ce composant n'a pas
   *  à connaître la session pour rester testable en isolation avec des props explicites. `false`
   *  retire le crayon d'édition — jamais un bouton désactivé ni un message d'erreur après coup,
   *  l'action ne doit simplement pas être proposée à qui ne peut pas l'accomplir. */
  readonly peutModifier: boolean;
  readonly className?: string;
}

/**
 * Aide-mémoire de position dans le garage (migration `0044`, Lot C du plan du parc simplifié,
 * `docs/specification-parc-et-hangar-pneus.md` §1.1/§1.3) — PAS un inventaire audité : texte
 * libre, vide normal et fréquent, aucun format imposé.
 *
 * Modification EN PLACE, sans dialogue ni formulaire séparé : c'est un geste que le comptoir fait
 * vingt fois par jour en passant (« devant, place 3 » → « chez le carrossier »), il doit coûter
 * deux clics (crayon, puis valider) — jamais un aller-retour vers un panneau de modification.
 */
export function ChampEmplacementVehicule({
  vehiculeId,
  emplacement,
  majLe,
  peutModifier,
  className,
}: ProprietesChampEmplacementVehicule) {
  const { t } = useTranslation(['vehicules', 'commun']);
  const mutation = useModifierEmplacementVehicule(vehiculeId);
  const [enEdition, setEnEdition] = useState(false);
  const [valeur, setValeur] = useState(emplacement ?? '');
  const champRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enEdition) champRef.current?.focus();
  }, [enEdition]);

  function ouvrirEdition() {
    setValeur(emplacement ?? '');
    mutation.reset();
    setEnEdition(true);
  }

  function annuler() {
    setValeur(emplacement ?? '');
    mutation.reset();
    setEnEdition(false);
  }

  function enregistrer() {
    const nettoye = valeur.trim();
    // Échec serveur : l'édition reste OUVERTE avec la saisie intacte (aucune perte de saisie,
    // standard non négociable) — `mutation.error` alimente le message affiché sous le champ.
    mutation.mutate(nettoye === '' ? null : nettoye, { onSuccess: () => setEnEdition(false) });
  }

  function gererClavier(evenement: KeyboardEvent<HTMLInputElement>) {
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      enregistrer();
    } else if (evenement.key === 'Escape') {
      evenement.preventDefault();
      annuler();
    }
  }

  if (!enEdition) {
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        <div className="flex items-center gap-1">
          <span className="texte-libelle text-muted-foreground">
            {t('vehicules:emplacement.titre')} :
          </span>
          <span className="texte-corps font-medium">
            {emplacement ?? t('vehicules:emplacement.vide')}
          </span>
          {peutModifier ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={ouvrirEdition}
              aria-label={t('commun:actions.modifier')}
              title={t('commun:actions.modifier')}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        {majLe ? (
          <p className="texte-libelle text-muted-foreground">
            {t('vehicules:emplacement.majLe', { date: formaterDateHeure(majLe) })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-champ', className)}>
      <div className="flex items-center gap-controles">
        <Input
          ref={champRef}
          value={valeur}
          onChange={(evenement) => setValeur(evenement.target.value)}
          onKeyDown={gererClavier}
          maxLength={LONGUEUR_MAX_EMPLACEMENT}
          placeholder={t('vehicules:emplacement.placeholder')}
          aria-label={t('vehicules:emplacement.titre')}
          disabled={mutation.isPending}
          className="max-w-64"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={enregistrer}
          disabled={mutation.isPending}
          aria-label={t('commun:actions.enregistrer')}
          title={t('commun:actions.enregistrer')}
        >
          {mutation.isPending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Check aria-hidden className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={annuler}
          disabled={mutation.isPending}
          aria-label={t('commun:actions.annuler')}
          title={t('commun:actions.annuler')}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </div>
      {mutation.isError ? (
        <p role="alert" className="texte-libelle text-destructive">
          {messageErreur(mutation.error, t)}
        </p>
      ) : null}
    </div>
  );
}
