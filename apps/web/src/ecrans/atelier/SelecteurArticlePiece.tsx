import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useRechercheComptoirPieces } from '@/hooks/pieces/useRechercheComptoirPieces';
import { formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { BadgeDisponibilitePiece } from './BadgeDisponibilitePiece';
import { calculerDisponibilitePiece } from './disponibilite-piece';

/** `403`/`404` : refus STABLE — un bouton « Réessayer » qui ne peut jamais réussir n'est jamais
 *  proposé (même doctrine que `disponibilite-piece.ts`, reproduite ici en local plutôt
 *  qu'importée : ce hook pilote un CHOIX D'AFFICHAGE de bouton, pas une politique de *retry* de
 *  `useQuery` comme `useDoitReessayer`, hors périmètre). */
function estRefusStable(erreur: unknown): boolean {
  return (
    erreur instanceof ErreurApi &&
    (erreur.probleme.status === 403 || erreur.probleme.status === 404)
  );
}

export interface ProprietesSelecteurArticlePiece {
  readonly id: string;
  /** Site de l'OR — la disponibilité annoncée au comptoir n'a de sens que POUR un site
   *  (`useRechercheComptoirPieces`, même doctrine que le module pièces). */
  readonly siteId: string;
  /** Appelé UNIQUEMENT sur un choix explicite (clic ou Entrée sur une suggestion) — jamais sur
   *  une simple frappe. La saisie manuelle de la désignation/référence/prix, juste en dessous
   *  dans le formulaire appelant, reste TOUJOURS possible et n'est jamais bloquée par ce champ :
   *  un garage qui monte une pièce hors catalogue continue de taper directement, sans détour par
   *  ici (constat terrain : un chemin manuel bloqué pousse à noter sur un papier à côté). */
  readonly onSelectionArticle: (article: ResultatRechercheComptoirArticle) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Recherche d'un article du magasin pour préremplir une ligne « pièce » d'un OR (référence,
 * désignation, prix) — au lieu de tout retaper à la main. Bâti sur `GET
 * /articles/recherche-comptoir` (`useRechercheComptoirPieces`, déjà en production côté comptoir
 * pièces), avec le même patron de combobox accessible que `ChampAutocompletionVehicule`
 * (`composants/vehicules/`, chantier `feat/referentiel-vehicules-targa` — pas encore fusionné sur
 * cette branche au moment de l'écriture, donc pas importable ici ; ce composant en reproduit la
 * structure ARIA/clavier localement plutôt que d'improviser un patron différent — voir le rapport
 * de livraison pour la recommandation de fusionner les deux une fois la branche mergée) : rôles
 * `combobox`/`listbox`/`option` écrits à la main plutôt que `cmdk` (`components/ui/command.tsx`),
 * dont `CommandInput` fixe `aria-expanded="true"` en dur indépendamment de l'ouverture réelle de
 * la liste — faux pour une liste qui s'ouvre/ferme vraiment comme ici.
 *
 * Un CHAMP DE RECHERCHE DISTINCT de la désignation (pas une autocomplétion DANS le champ
 * désignation) : une fois un article choisi, la désignation/référence/prix restent des champs
 * normaux, librement réédités par le garagiste, sans lien caché ni resynchronisation surprise.
 */
export function SelecteurArticlePiece({
  id,
  siteId,
  onSelectionArticle,
  disabled,
  className,
}: ProprietesSelecteurArticlePiece) {
  const { t } = useTranslation(['or', 'erreurs']);
  const idBase = useId();
  const idListe = `${idBase}-listbox`;
  const idOption = (index: number) => `${idBase}-option-${String(index)}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);

  const { saisie, onSaisieChange, enChargement, resultats, enErreur, erreur, relancer } =
    useRechercheComptoirPieces(siteId);

  const options = resultats ?? [];

  function choisir(article: ResultatRechercheComptoirArticle) {
    onSelectionArticle(article);
    onSaisieChange('');
    setOuvert(false);
    setIndexActif(-1);
    inputRef.current?.focus();
  }

  function gererClavier(evenement: KeyboardEvent<HTMLInputElement>) {
    switch (evenement.key) {
      case 'ArrowDown': {
        if (options.length === 0) return;
        evenement.preventDefault();
        setOuvert(true);
        setIndexActif((index) => Math.min(index + 1, options.length - 1));
        return;
      }
      case 'ArrowUp': {
        if (options.length === 0) return;
        evenement.preventDefault();
        setOuvert(true);
        setIndexActif((index) => Math.max(index - 1, 0));
        return;
      }
      case 'Home': {
        if (!ouvert || options.length === 0) return;
        evenement.preventDefault();
        setIndexActif(0);
        return;
      }
      case 'End': {
        if (!ouvert || options.length === 0) return;
        evenement.preventDefault();
        setIndexActif(options.length - 1);
        return;
      }
      case 'Enter': {
        if (!ouvert || indexActif < 0) return; // saisie libre : Entrée sans sélection ne fait rien de spécial ici.
        const article = options[indexActif];
        if (!article) return;
        evenement.preventDefault();
        choisir(article);
        return;
      }
      case 'Escape': {
        if (!ouvert) return;
        evenement.preventDefault();
        evenement.stopPropagation();
        setOuvert(false);
        setIndexActif(-1);
        return;
      }
      default:
        return;
    }
  }

  let annonceLive = '';
  if (ouvert) {
    if (enChargement) {
      annonceLive = t('or:lignes.selecteurArticle.recherche');
    } else if (enErreur) {
      annonceLive = messageErreur(erreur, t);
    } else if (saisie.trim() === '') {
      annonceLive = t('or:lignes.selecteurArticle.aide');
    } else if (options.length === 0) {
      annonceLive = t('or:lignes.selecteurArticle.aucunResultat');
    } else {
      annonceLive = t('or:lignes.selecteurArticle.resultats', { count: options.length });
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{t('or:lignes.selecteurArticle.label')}</Label>
      <Popover open={ouvert} onOpenChange={setOuvert}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-label={t('or:lignes.selecteurArticle.label')}
            aria-expanded={ouvert}
            aria-controls={idListe}
            aria-autocomplete="list"
            aria-activedescendant={indexActif >= 0 ? idOption(indexActif) : undefined}
            autoComplete="off"
            disabled={disabled}
            value={saisie}
            placeholder={t('or:lignes.selecteurArticle.placeholder')}
            onChange={(evenement) => {
              onSaisieChange(evenement.target.value);
              setOuvert(true);
              setIndexActif(-1);
            }}
            onFocus={() => setOuvert(true)}
            onBlur={() => setOuvert(false)}
            onKeyDown={gererClavier}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(evenement) => evenement.preventDefault()}
          onCloseAutoFocus={(evenement) => evenement.preventDefault()}
          // Même correctif que `ChampAutocompletionVehicule` : `PopoverAnchor` n'est pas exclu de
          // la détection « clic extérieur » de Radix, ce qui referme la liste au focus initial
          // avant même la première frappe. Ce composant gère déjà sa fermeture lui-même de façon
          // exhaustive (`onBlur`, Échap, sélection) — la détection Radix est redondante ici.
          onPointerDownOutside={(evenement) => evenement.preventDefault()}
          onFocusOutside={(evenement) => evenement.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          {enChargement ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('or:lignes.selecteurArticle.recherche')}
            </p>
          ) : enErreur ? (
            <div className="flex flex-col items-center gap-2 px-2 py-3 text-center">
              <p className="texte-corps text-muted-foreground">{messageErreur(erreur, t)}</p>
              {!estRefusStable(erreur) ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onMouseDown={(evenement) => evenement.preventDefault()}
                  onClick={() => relancer()}
                >
                  {t('or:lignes.selecteurArticle.erreur.reessayer')}
                </Button>
              ) : null}
            </div>
          ) : saisie.trim() === '' ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('or:lignes.selecteurArticle.aide')}
            </p>
          ) : options.length === 0 ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('or:lignes.selecteurArticle.aucunResultat')}
            </p>
          ) : (
            <ul
              id={idListe}
              role="listbox"
              aria-label={t('or:lignes.selecteurArticle.label')}
              className="flex flex-col gap-0.5"
            >
              {options.map((article, index) => (
                <li
                  key={article.articleId}
                  id={idOption(index)}
                  role="option"
                  aria-selected={index === indexActif}
                  onMouseDown={(evenement) => evenement.preventDefault()}
                  onClick={() => choisir(article)}
                  className={cn(
                    'element-menu flex cursor-pointer select-none flex-col gap-0.5 rounded-sm px-2 py-2 outline-none',
                    index === indexActif ? 'bg-accent text-accent-foreground' : undefined,
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="texte-corps font-medium">{article.designation}</span>
                    <span className="tabular-nums texte-corps">
                      {formaterMontant(article.prixVenteTtcCentimes)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 texte-libelle text-muted-foreground">
                    <span className="font-mono">{article.referencePrincipale}</span>
                  </div>
                  {/* Disponibilité visible AU MOMENT DU CHOIX (constat terrain) — le même badge
                      trois-états que le résumé post-sélection, jamais un nombre nu qui laisserait
                      deviner s'il s'agit d'un stock réellement vérifié. */}
                  <BadgeDisponibilitePiece
                    etat={calculerDisponibilitePiece(
                      article.statutSuivi,
                      article.quantiteDisponibleMillieme,
                    )}
                  />
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {/* Annonce ARIA seule — le texte VISIBLE équivalent vit dans `PopoverContent` ci-dessus
          (états chargement/aide/erreur/aucunRésultat/décompte) : pas de troisième copie statique
          ici, qui ne ferait que dupliquer ce que le popover affiche déjà dès qu'il s'ouvre. */}
      <span role="status" aria-live="polite" className="sr-only">
        {annonceLive}
      </span>
    </div>
  );
}
