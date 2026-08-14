import { useTranslation } from 'react-i18next';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover } from '@/components/ui/popover';
import {
  AnnonceLiveCombobox,
  ChampCombobox,
  ListeOptionsCombobox,
  OptionCombobox,
  PopoverContenuCombobox,
  useComboboxAccessible,
} from '@/composants/saisie/ComboboxAccessible';
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
 * pièces). La mécanique combobox (champ + popover, navigation clavier, ARIA
 * `combobox`/`listbox`/`option`) vient de `composants/saisie/ComboboxAccessible` — dette
 * technique n°4 : cette implémentation reproduisait localement la même structure que
 * `ChampAutocompletionVehicule` (`composants/vehicules/`) pendant que celui-ci vivait sur une
 * branche non fusionnée ; les deux reposent maintenant sur le même primitif. Ce qui reste propre
 * à cet écran : la source des suggestions (`useRechercheComptoirPieces`), le rendu d'une
 * suggestion (désignation/prix/référence/disponibilité), le refus stable 403/404 (pas de
 * « Réessayer » qui ne peut jamais réussir) et l'aide « tapez pour chercher ».
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

  const {
    saisie,
    onSaisieChange,
    enParcours,
    enChargement,
    resultats,
    enErreur,
    erreur,
    relancer,
  } = useRechercheComptoirPieces(siteId);

  const options = resultats ?? [];

  const combobox = useComboboxAccessible<ResultatRechercheComptoirArticle>({
    options,
    onChoisir: (article) => {
      onSelectionArticle(article);
      onSaisieChange('');
    },
  });

  /** Message d'erreur affiché, distingué par SOURCE (règle maison « absence de donnée ≠ valeur ») :
   *  le catalogue parcours et la recherche assistée n'échouent jamais pour la même raison aux yeux
   *  du garagiste — l'un dit « catalogue indisponible », l'autre le message générique existant.
   *  Le bouton « Réessayer » (`estRefusStable`, `relancer`) reste inchangé dans les deux cas : ce
   *  n'est que le TEXTE qui change selon `enParcours`. */
  const texteErreur = enParcours
    ? t('or:lignes.selecteurArticle.erreur.parcours', { message: messageErreur(erreur, t) })
    : messageErreur(erreur, t);

  /** Texte « vide » distingué par source, jamais confondu (règle maison) : un catalogue de site
   *  réellement vide (mode parcours) n'est pas « aucun résultat » (mode recherche, réservé à une
   *  recherche sans correspondance). */
  const texteVide = enParcours
    ? t('or:lignes.selecteurArticle.parcours.vide')
    : t('or:lignes.selecteurArticle.aucunResultat');

  let annonceLive = '';
  if (combobox.ouvert) {
    if (enChargement) {
      annonceLive = t('or:lignes.selecteurArticle.recherche');
    } else if (enErreur) {
      annonceLive = texteErreur;
    } else if (options.length === 0) {
      annonceLive = texteVide;
    } else {
      annonceLive = t('or:lignes.selecteurArticle.resultats', { count: options.length });
    }
  }

  const listeArticles = (
    <ListeOptionsCombobox id={combobox.idListe} ariaLabel={t('or:lignes.selecteurArticle.label')}>
      {options.map((article, index) => (
        <OptionCombobox
          key={article.articleId}
          id={combobox.idOption(index)}
          actif={index === combobox.indexActif}
          onClick={() => combobox.choisir(article)}
          className="flex flex-col gap-0.5"
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
        </OptionCombobox>
      ))}
    </ListeOptionsCombobox>
  );

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{t('or:lignes.selecteurArticle.label')}</Label>
      <Popover open={combobox.ouvert} onOpenChange={combobox.setOuvert}>
        <ChampCombobox
          ref={combobox.inputRef}
          id={id}
          ariaLabel={t('or:lignes.selecteurArticle.label')}
          ouvert={combobox.ouvert}
          idListe={combobox.idListe}
          idActif={combobox.idActif}
          disabled={disabled}
          value={saisie}
          placeholder={t('or:lignes.selecteurArticle.placeholder')}
          onChange={(evenement) => {
            onSaisieChange(evenement.target.value);
            combobox.gererSaisie();
          }}
          onFocus={combobox.gererFocus}
          onBlur={combobox.gererPerteFocus}
          onKeyDown={combobox.gererClavier}
        />
        <PopoverContenuCombobox>
          {enChargement ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('or:lignes.selecteurArticle.recherche')}
            </p>
          ) : enErreur ? (
            <div className="flex flex-col items-center gap-2 px-2 py-3 text-center">
              <p className="texte-corps text-muted-foreground">{texteErreur}</p>
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
          ) : options.length === 0 ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">{texteVide}</p>
          ) : enParcours ? (
            <>
              {/* Légende du mode PARCOURS : rappelle que la saisie ci-dessus reste possible EN
                  PLUS de la liste — un garagiste qui ne connaît pas la référence doit pouvoir
                  parcourir le catalogue actif du site (même besoin terrain que le comptoir
                  pièces, `EcranRechercheComptoirPieces`). */}
              <p className="px-2 pt-2 pb-1 text-center texte-libelle text-muted-foreground">
                {t('or:lignes.selecteurArticle.parcours.aide')}
              </p>
              {listeArticles}
            </>
          ) : (
            listeArticles
          )}
        </PopoverContenuCombobox>
      </Popover>

      {/* Annonce ARIA seule — le texte VISIBLE équivalent vit dans `PopoverContenuCombobox`
          ci-dessus (états chargement/aide/erreur/aucunRésultat/décompte) : pas de troisième copie
          statique ici, qui ne ferait que dupliquer ce que le popover affiche déjà dès qu'il
          s'ouvre. */}
      <AnnonceLiveCombobox>{annonceLive}</AnnonceLiveCombobox>
    </div>
  );
}
