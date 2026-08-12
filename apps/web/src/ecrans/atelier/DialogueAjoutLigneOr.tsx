import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  ORIGINES_LIGNE_OR,
  TYPES_LIGNE_OR,
  schemaCreationLigneOr,
  type OrigineLigneOr,
  type PayeurLigneOr,
  type ResultatRechercheComptoirArticle,
  type TypeLigneOr,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useCreerLigneOr } from '@/hooks/atelier/useActionsLigneOr';
import { useArticle } from '@/hooks/pieces/useArticle';
import { formaterMontant } from '@/lib/formats';

import { BadgeDisponibilitePiece } from './BadgeDisponibilitePiece';
import { calculerDisponibilitePiece, convertirTtcVersHtCentimes } from './disponibilite-piece';
import { messagesErreurMutation } from './messages-erreur-mutation';
import { CLES_TYPE } from './ListeLignesOrdreReparation';
import { SelecteurArticlePiece } from './SelecteurArticlePiece';

interface Props {
  readonly orId: string;
  /**
   * Site de l'OR — permet d'interroger la disponibilité magasin au bon endroit
   * (`SelecteurArticlePiece`, même doctrine que `useRechercheComptoirPieces`).
   * `ReponseOrdreReparation.siteId` n'est jamais absent en pratique (§contrat).
   * Requis pour afficher le raccourci catalogue : un magasinier qui ouvre le dialogue
   * depuis un ordre de réparation doit toujours pouvoir chercher une pièce.
   */
  readonly siteId: string;
}

const TYPES_MAIN_OEUVRE: ReadonlySet<TypeLigneOr> = new Set([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
]);

/** "1.5" / "1,5" -> entier mis à l'échelle (`multiplicateur` = 1000 pour une quantité en
 *  millièmes, 100 pour un temps en centièmes d'heure) ; `null` si non interprétable OU non
 *  strictement positif — même doctrine que `ChampMontant.analyserCentimes` : jamais de valeur
 *  devinée pour une saisie invalide, l'appelant doit la refuser plutôt que la corriger en douce. */
function analyserDecimalPositif(saisie: string, multiplicateur: number): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return null;
  if (!/^\d+(\.\d+)?$/.test(normalisee)) return null;
  const valeur = Number.parseFloat(normalisee);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  return Math.round(valeur * multiplicateur);
}

interface EtatFormulaire {
  readonly type: TypeLigneOr;
  readonly origine: OrigineLigneOr;
  readonly designation: string;
  readonly referenceTexte: string;
  readonly quantiteSaisie: string;
  readonly tempsBaremeSaisie: string;
  readonly prixUnitaireCentimes: number | null;
  readonly payeur: PayeurLigneOr;
  readonly securite: boolean;
  readonly fournieParClient: boolean;
  readonly pieceARestituer: boolean;
  /** Article du magasin choisi via `SelecteurArticlePiece` (`null` = saisie manuelle, TOUJOURS le
   *  cas par défaut — voir `RP-19`/`RP-20` : renseigné et `fournieParClient = false` fait naître
   *  une réservation de stock comme effet de bord SERVEUR de `POST …/lignes`). Vidé dès que `type`
   *  quitte `piece` — n'a de sens que pour une ligne pièce. */
  readonly articleId: string | null;
}

const ETAT_INITIAL: EtatFormulaire = {
  type: 'main_oeuvre_bareme',
  origine: 'commandee',
  designation: '',
  referenceTexte: '',
  quantiteSaisie: '1',
  tempsBaremeSaisie: '',
  prixUnitaireCentimes: null,
  payeur: 'client',
  securite: false,
  fournieParClient: false,
  pieceARestituer: false,
  articleId: null,
};

/**
 * `POST /ordres-reparation/{orId}/lignes` (§7.8) — saisie manuelle d'une ligne de travail ou de
 * pièce. Monté UNIQUEMENT derrière `peutCreerLigneOr(role)` (`ecrans/atelier/droits.ts`) par
 * l'appelant (`EcranFicheOrdreReparation`) : ce composant ne revérifie donc pas le droit dans son
 * JSX — même doctrine que `PanneauActionsOr`, qui ne revérifie pas non plus `or.actionsDisponibles`
 * une fois le bouton affiché. Le serveur reste l'arbitre final (`@ExigerDroit('atelier.ligne.creer')`).
 *
 * PÉRIMÈTRE VOLONTAIREMENT RÉDUIT pour ce correctif (débloquer la chaîne OR -> facturation),
 * additif à étendre au fil de l'eau :
 *  - `payeur` limité à `client`/`garage` — `constructeur`/`assurance`/`tiers` exigent un
 *    sélecteur de tiers payeur (`payeurClientId`, AC-08/MD-62) qui n'existe encore dans aucun
 *    écran ;
 *  - aucune affectation de technicien à la création (`technicienId`).
 * Aucun de ces deux manques ne bloque la chaîne devis -> facture que ce correctif rouvre.
 *
 * CORRECTIF (rapport de test terrain) : une ligne « pièce » saisie ici RESTE saisissable
 * intégralement à la main (désignation/référence/prix tapés, aucun lien catalogue) — mais peut
 * DÉSORMAIS aussi reprendre un article du magasin via `SelecteurArticlePiece`, qui préremplit
 * référence/désignation/prix et pose `articleId` sur `entree` (accepté par `schemaCreationLigneOr`
 * depuis l'étape 3 pièces, RP-19/RP-20 : fait naître une réservation de stock comme effet de bord
 * SERVEUR quand `fournieParClient = false`). `POST …/lignes-depuis-prestation` reste un chemin
 * DISTINCT (prestations catalogue à prix figé serveur, hors périmètre ici) — ce correctif ne le
 * remplace pas, il comble seulement l'absence de raccourci catalogue sur CE dialogue.
 */
export function DialogueAjoutLigneOr({ orId, siteId }: Props) {
  const { t } = useTranslation(['or', 'commun', 'validation']);
  const mutation = useCreerLigneOr(orId);
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatFormulaire>(ETAT_INITIAL);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const estMainOeuvre = TYPES_MAIN_OEUVRE.has(etat.type);
  const estPiece = etat.type === 'piece';
  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;

  // Résultat de recherche magasin CHOISI (`SelecteurArticlePiece`) — porte déjà `statutSuivi` et
  // `quantiteDisponibleMillieme` (contrat `ResultatRechercheComptoirArticle`, @dfa/shared) : la
  // disponibilité en trois états s'affiche donc IMMÉDIATEMENT au choix, sans requête
  // supplémentaire. Distinct de `etat.articleId` (soumis au serveur) : purement présentationnel,
  // jamais envoyé tel quel.
  const [resultatChoisi, setResultatChoisi] = useState<ResultatRechercheComptoirArticle | null>(
    null,
  );

  // Fiche complète de l'article choisi — SEULEMENT pour connaître son taux de TVA courant
  // (préremplissage du prix HT ci-dessous, RM-01 : jamais une copie brute du TTC catalogue,
  // voir `convertirTtcVersHtCentimes`). Le résultat de recherche ci-dessus ne porte PAS ce taux.
  const detailArticlePourPrix = useArticle(etat.articleId ?? undefined);

  // Préremplit le prix unitaire HT UNE SEULE FOIS par sélection, dès que le taux de TVA de
  // l'article est connu — jamais une seconde fois pour le MÊME `articleId` : si le garagiste
  // corrige ensuite le prix à la main, cet effet ne doit jamais l'écraser (`dernierArticleApplique`
  // mémorise pour quel `articleId` le prix a déjà été posé).
  const dernierArticleApplique = useRef<string | null>(null);
  useEffect(() => {
    if (!etat.articleId) {
      dernierArticleApplique.current = null;
      return;
    }
    if (dernierArticleApplique.current === etat.articleId) return;
    if (detailArticlePourPrix.data && detailArticlePourPrix.data.id === etat.articleId) {
      const prixHt = convertirTtcVersHtCentimes(
        detailArticlePourPrix.data.prixVenteTtcCentimes,
        detailArticlePourPrix.data.tauxTvaPourmille,
      );
      dernierArticleApplique.current = etat.articleId;
      setEtat((precedent) =>
        precedent.articleId === etat.articleId
          ? { ...precedent, prixUnitaireCentimes: prixHt }
          : precedent,
      );
    }
  }, [etat.articleId, detailArticlePourPrix.data]);

  const disponibilitePiece = resultatChoisi
    ? calculerDisponibilitePiece(
        resultatChoisi.statutSuivi,
        resultatChoisi.quantiteDisponibleMillieme,
      )
    : null;

  function fermer() {
    setOuvert(false);
    setEtat(ETAT_INITIAL);
    setErreurValidation(null);
    setResultatChoisi(null);
    mutation.reset();
  }

  function majEtat(partiel: Partial<EtatFormulaire>) {
    setEtat((precedent) => ({ ...precedent, ...partiel }));
  }

  /** Choix d'un article au magasin (`SelecteurArticlePiece`) : reprend référence/désignation/prix
   *  affiché — le prix unitaire HT réel est posé par l'effet ci-dessus dès que le taux de TVA de
   *  l'article est connu, jamais deviné ici. La saisie manuelle reste intacte pour tout le reste :
   *  ce choix ne fait QUE préremplir, jamais un verrou sur les champs. */
  function choisirArticle(article: ResultatRechercheComptoirArticle) {
    majEtat({
      designation: article.designation,
      referenceTexte: article.referencePrincipale,
      articleId: article.articleId,
    });
    setResultatChoisi(article);
  }

  /** Dissocie l'article choisi (bouton « Chercher une autre pièce ») — la désignation/référence/
   *  prix déjà repris RESTENT dans le formulaire, librement réédités ; seul le lien catalogue et
   *  la disponibilité affichée disparaissent. */
  function dissocierArticle() {
    majEtat({ articleId: null });
    setResultatChoisi(null);
  }

  function soumettre() {
    if (etat.designation.trim() === '') {
      setErreurValidation(t('validation:requis'));
      return;
    }

    let quantiteMillieme = 1000;
    if (!estMainOeuvre) {
      const analysee = analyserDecimalPositif(etat.quantiteSaisie, 1000);
      if (analysee === null) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      quantiteMillieme = analysee;
    }

    let tempsBaremeCentiemes: number | undefined;
    if (estMainOeuvre && etat.tempsBaremeSaisie.trim() !== '') {
      const analysee = analyserDecimalPositif(etat.tempsBaremeSaisie, 100);
      if (analysee === null) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      tempsBaremeCentiemes = analysee;
    }

    // Type d'ENTRÉE (`z.input`), pas `EntreeCreationLigneOr` (`z.infer`, type de SORTIE) : `blocage`
    // porte un `.default('aucun')` dans `schemaCreationLigneOr` — absent ici, il est résolu par
    // `safeParse` juste en dessous, jamais deviné à la main dans ce composant.
    const entree: z.input<typeof schemaCreationLigneOr> = {
      type: etat.type,
      origine: etat.origine,
      designation: etat.designation.trim(),
      referenceTexte: etat.referenceTexte.trim() === '' ? undefined : etat.referenceTexte.trim(),
      quantiteMillieme,
      tempsBaremeCentiemes,
      prixUnitaireCentimes: estMainOeuvre ? undefined : (etat.prixUnitaireCentimes ?? undefined),
      rabaisPourmille: 0,
      payeur: etat.payeur,
      securite: etat.securite,
      fournieParClient: etat.type === 'piece' ? etat.fournieParClient : false,
      pieceARestituer: etat.type === 'piece' ? etat.pieceARestituer : false,
      articleId: etat.type === 'piece' ? (etat.articleId ?? undefined) : undefined,
    };

    const resultat = schemaCreationLigneOr.safeParse(entree);
    if (!resultat.success) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    setErreurValidation(null);
    mutation.mutate(
      { entree: resultat.data, idempotencyKey: genererCleIdempotence() },
      { onSuccess: () => fermer() },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => (valeur ? setOuvert(true) : fermer())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('or:lignes.ajouter')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('or:lignes.ajouter')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-type">{t('or:lignes.colonnes.type')}</Label>
              <Select
                value={etat.type}
                onValueChange={(valeur) => {
                  // `articleId` n'a de sens QUE pour une ligne « pièce » — le quitter dissocie
                  // proprement l'article choisi, jamais une réservation fantôme sur une ligne
                  // devenue main d'œuvre/forfait/remise.
                  if (valeur !== 'piece') setResultatChoisi(null);
                  majEtat({
                    type: valeur as TypeLigneOr,
                    articleId: valeur === 'piece' ? etat.articleId : null,
                  });
                }}
              >
                <SelectTrigger id="or-ligne-type" aria-label={t('or:lignes.colonnes.type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES_LIGNE_OR.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {t(`or:lignes.types.${CLES_TYPE[valeur]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-origine">{t('or:lignes.colonnes.origine')}</Label>
              <Select
                value={etat.origine}
                onValueChange={(valeur) => majEtat({ origine: valeur as OrigineLigneOr })}
              >
                <SelectTrigger id="or-ligne-origine" aria-label={t('or:lignes.colonnes.origine')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGINES_LIGNE_OR.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {t(`or:lignes.origines.${valeur}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {estPiece ? (
            <SelecteurArticlePiece
              id="or-ligne-recherche-article"
              siteId={siteId}
              onSelectionArticle={choisirArticle}
            />
          ) : null}

          {estPiece && etat.articleId ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="texte-libelle text-muted-foreground">
                {t('or:lignes.selecteurArticle.choisi')}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={dissocierArticle}
              >
                {t('or:lignes.selecteurArticle.changer')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-designation">{t('or:lignes.colonnes.designation')} *</Label>
            <Input
              id="or-ligne-designation"
              value={etat.designation}
              maxLength={200}
              onChange={(evenement) => majEtat({ designation: evenement.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-reference">{t('or:lignes.champs.referenceTexte')}</Label>
            <Input
              id="or-ligne-reference"
              value={etat.referenceTexte}
              maxLength={80}
              onChange={(evenement) => majEtat({ referenceTexte: evenement.target.value })}
            />
          </div>

          {estMainOeuvre ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-temps">{t('or:lignes.colonnes.tempsBareme')}</Label>
              <Input
                id="or-ligne-temps"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={etat.tempsBaremeSaisie}
                onChange={(evenement) => majEtat({ tempsBaremeSaisie: evenement.target.value })}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-ligne-quantite">{t('or:lignes.colonnes.quantite')}</Label>
                <Input
                  id="or-ligne-quantite"
                  type="text"
                  inputMode="decimal"
                  value={etat.quantiteSaisie}
                  onChange={(evenement) => majEtat({ quantiteSaisie: evenement.target.value })}
                />
              </div>
              <ChampMontant
                id="or-ligne-prix"
                valeurCentimes={etat.prixUnitaireCentimes}
                onChangeCentimes={(centimes) => majEtat({ prixUnitaireCentimes: centimes })}
                label={t('or:lignes.colonnes.prixUnitaire')}
              />
            </div>
          )}

          {estPiece && disponibilitePiece ? (
            <div className="flex flex-col gap-1">
              <BadgeDisponibilitePiece etat={disponibilitePiece} />
              {detailArticlePourPrix.data ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('or:lignes.selecteurArticle.prixConverti', {
                    prixTtc: formaterMontant(detailArticlePourPrix.data.prixVenteTtcCentimes),
                    taux: (detailArticlePourPrix.data.tauxTvaPourmille / 10).toFixed(1),
                  })}
                </p>
              ) : detailArticlePourPrix.isPending ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('or:lignes.selecteurArticle.calculPrixEnCours')}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-payeur">{t('or:lignes.colonnes.payeur')}</Label>
            <Select
              value={etat.payeur}
              onValueChange={(valeur) => majEtat({ payeur: valeur as PayeurLigneOr })}
            >
              <SelectTrigger id="or-ligne-payeur" aria-label={t('or:lignes.colonnes.payeur')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">{t('or:lignes.payeurs.client')}</SelectItem>
                <SelectItem value="garage">{t('or:lignes.payeurs.garage')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label htmlFor="or-ligne-securite" className="flex items-center gap-2 texte-corps">
            <Checkbox
              id="or-ligne-securite"
              checked={etat.securite}
              onCheckedChange={(coche) => majEtat({ securite: coche === true })}
            />
            {t('or:lignes.marqueurs.securite')}
          </label>

          {etat.type === 'piece' ? (
            <>
              <label
                htmlFor="or-ligne-fournie-client"
                className="flex items-center gap-2 texte-corps"
              >
                <Checkbox
                  id="or-ligne-fournie-client"
                  checked={etat.fournieParClient}
                  onCheckedChange={(coche) => majEtat({ fournieParClient: coche === true })}
                />
                {t('or:lignes.marqueurs.fournieParClient')}
              </label>
              <label htmlFor="or-ligne-a-restituer" className="flex items-center gap-2 texte-corps">
                <Checkbox
                  id="or-ligne-a-restituer"
                  checked={etat.pieceARestituer}
                  onCheckedChange={(coche) => majEtat({ pieceARestituer: coche === true })}
                />
                {t('or:lignes.marqueurs.pieceARestituer')}
              </label>
            </>
          ) : null}

          {erreurValidation ? (
            <p className="texte-libelle text-destructive">{erreurValidation}</p>
          ) : null}
          {erreurActive
            ? messagesErreurMutation(erreurActive, t).map((message, index) => (
                <p key={index} role="alert" className="texte-libelle text-destructive">
                  {message}
                </p>
              ))
            : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button enChargement={mutation.isPending} onClick={soumettre}>
            {t('or:actions.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
