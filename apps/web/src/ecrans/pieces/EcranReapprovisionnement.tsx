import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { LigneReapprovisionnement } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useModifierStockSite } from '@/hooks/pieces/useModifierStockSite';
import { useReapprovisionnement } from '@/hooks/pieces/useReapprovisionnement';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { peutEcrireCommandeFournisseur, peutEcrireStockSite } from './droits';
import type { EtatPreremplissageCommandeFournisseur } from './etat-preremplissage-commande';
import { messageErreurMutation } from './messages-erreur-mutation';
import { SelecteurSiteRequis } from './SelecteurSiteRequis';
import {
  formaterQuantiteMillieme,
  quantiteMilliemeVersSaisie,
  saisieVersSeuilMillieme,
} from './utils';

/**
 * Réapprovisionnement (RP-12, priorité 4 du brief) — articles sous leur stock minimum, par site.
 * Propose, ne commande JAMAIS automatiquement (§7.5 du contrat) : aucune ligne n'est envoyée au
 * fournisseur sans un passage explicite par `EcranNouvelleCommandeFournisseur`, où le magasinier
 * garde la main sur fournisseur/quantités/prix avant de créer la commande. Ce que CET écran câble
 * (§ correctif) : une sélection de lignes + une action « Commander » qui OUVRE cet écran
 * pré-rempli (quantités suggérées) — jamais une création directe depuis ici. Réservé aux rôles
 * habilités à créer une commande fournisseur (`peutEcrireCommandeFournisseur`, même droit que
 * `EcranListeCommandesFournisseur`) : un rôle en lecture seule sur ce sous-domaine voit la liste
 * mais aucune case à cocher ni bouton, cet écran reste alors une pure consultation.
 */
export function EcranReapprovisionnement() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const peutCommander = peutEcrireCommandeFournisseur(session?.utilisateur.role);
  // Seuil de réapprovisionnement (#121) — LES DEUX emplacements envisagés se justifient, pas un
  // seul : ici, une ÉDITION (voir `CelluleSeuil` plus bas), pré-remplie d'une valeur TOUJOURS
  // réelle — `LigneReapprovisionnement` est le SEUL endroit du contrat qui rend
  // `stockMinimumMillieme` lisible sans appel supplémentaire (`ReponseArticle.stocksResume` ne le
  // porte pas, `contrats/pieces/article.ts::StockResumeArticle`), et une ligne n'existe ici que
  // parce qu'un seuil EST posé et dépassé. `PanneauStockArticle.ActionSeuilSite` couvre l'AUTRE
  // moitié du besoin (poser un seuil sur un article qui a encore largement de stock, avant qu'il
  // ne manque) avec une ACTION D'ÉCRITURE plutôt qu'une édition — voir son commentaire : aucune
  // route `GET` n'expose la valeur actuelle en dehors de cette liste, un formulaire pré-rempli y
  // serait donc un mensonge. Droit distinct de `peutCommander` (`pieces.stock.modifier` côté
  // serveur, `StockArticleController.modifierSite`), pas celui de la commande fournisseur.
  const peutModifierSeuil = peutEcrireStockSite(session?.utilisateur.role);

  const {
    lignes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useReapprovisionnement(site);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  function basculerSelection(articleId: string) {
    setSelection((valeur) => {
      const suivante = new Set(valeur);
      if (suivante.has(articleId)) {
        suivante.delete(articleId);
      } else {
        suivante.add(articleId);
      }
      return suivante;
    });
  }

  function commanderSelection() {
    if (!site || selection.size === 0) return;
    const lignesSelectionnees = lignes.filter((ligne) => selection.has(ligne.articleId));
    // DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°4) : la quantité proposée était
    // `quantiteCommandeStandardMillieme` (lot fournisseur habituel, PP-08 — « le fournisseur vend
    // par lot de 10, pas à l'unité ») QUAND ce réglage existait, sans jamais tenir compte de
    // l'écart RÉEL affiché dans cette même liste (colonne « Écart ») — un magasinier voyait
    // « manquant : 3 » puis se retrouvait avec une commande pré-remplie à 4 (ou toute autre valeur
    // du lot standard), sans lien apparent entre les deux nombres.
    //
    // DÉCISION : `ecartMillieme` est TOUJOURS la quantité juste métier ici — commander exactement
    // le manquant fait repasser l'article au-dessus du seuil (`ecartMillieme = stockMinimumMillieme
    // - quantiteDisponibleMillieme`, RP-12), et c'est le nombre que le magasinier vient de lire
    // dans CETTE table, jamais une substitution invisible. `quantiteCommandeStandardMillieme`
    // (lot fournisseur) reste un réglage réel et utile — mais UNIQUEMENT comme information que le
    // magasinier applique lui-même en ajustant la quantité proposée sur l'écran suivant (il sait,
    // lui, si son fournisseur impose des lots), jamais comme substitution automatique et silencieuse
    // d'un nombre par un autre : les deux chiffres ont chacun un sens, mais un seul est LA quantité
    // qui répond à « de combien ai-je besoin maintenant ».
    const etat: EtatPreremplissageCommandeFournisseur = {
      siteId: site,
      lignes: lignesSelectionnees.map((ligne) => ({
        articleId: ligne.articleId,
        numeroArticle: ligne.numeroArticle,
        designation: ligne.designation,
        quantiteSuggereeMillieme: ligne.ecartMillieme,
      })),
    };
    navigate(chemins.pieces.commandesFournisseur.nouvelle(), { state: etat });
  }

  const colonnes: ColonneComptoir<LigneReapprovisionnement>[] = [
    ...(peutCommander
      ? [
          {
            id: 'selection',
            libelle: (
              <span className="sr-only">
                {t('pieces:stock.reapprovisionnement.actions.commander')}
              </span>
            ),
            actions: true,
            className: 'w-10',
            rendu: (ligne: LigneReapprovisionnement) => (
              <Checkbox
                checked={selection.has(ligne.articleId)}
                onCheckedChange={() => basculerSelection(ligne.articleId)}
                aria-label={t('pieces:stock.reapprovisionnement.selection.aria', {
                  designation: ligne.designation,
                })}
              />
            ),
          } satisfies ColonneComptoir<LigneReapprovisionnement>,
        ]
      : []),
    {
      id: 'article',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.article'),
      rendu: (ligne) => (
        <div className="flex flex-col">
          <span className="font-medium">{ligne.designation}</span>
          <span className="texte-libelle text-muted-foreground">
            {t('pieces:articles.numero', { numero: ligne.numeroArticle })}
          </span>
        </div>
      ),
    },
    {
      id: 'disponible',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.disponible'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">
          {formaterQuantiteMillieme(ligne.quantiteDisponibleMillieme)}
        </span>
      ),
    },
    {
      id: 'minimum',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.minimum'),
      alignement: 'droite',
      // `actions: true` — même geste que la colonne de sélection ci-dessus : la cellule porte un
      // déclencheur de popover interactif, son clic ne doit jamais activer la navigation de ligne
      // (`onOuvrirLigne`, `TableComptoir.tsx`).
      actions: true,
      rendu: (ligne) => <CelluleSeuil ligne={ligne} peutModifier={peutModifierSeuil} />,
    },
    {
      id: 'ecart',
      libelle: t('pieces:stock.reapprovisionnement.ecart'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-destructive">
          {formaterQuantiteMillieme(ligne.ecartMillieme)}
        </span>
      ),
    },
  ];

  if (!site) {
    return (
      <GabaritEcran titre={t('pieces:stock.reapprovisionnement.titre')}>
        <div className="mx-auto w-full max-w-lg">
          <SelecteurSiteRequis onChoisir={(siteId) => setSearchParams({ site: siteId })} />
        </div>
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:stock.reapprovisionnement.titre')}>
        <EtatErreur
          titre={t('pieces:stock.reapprovisionnement.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  const actionCommander =
    peutCommander && selection.size > 0 ? (
      // Bordure CONSERVÉE (DESIGN.md) : barre d'action contextuelle liée à une sélection active
      // dans le tableau — zone à comportement distinct, pas un simple groupe de contenu.
      <div className="flex items-center gap-controles rounded-md border bg-muted/50 px-3 py-2">
        <span className="texte-corps text-foreground">
          {t('pieces:stock.reapprovisionnement.selection.nombreSelectionnes', {
            count: selection.size,
          })}
        </span>
        <Button type="button" onClick={commanderSelection}>
          {t('pieces:stock.reapprovisionnement.actions.commander')}
        </Button>
      </div>
    ) : undefined;

  // « Commander » ne siège PAS dans le slot `actions` du gabarit (qui le placerait juste sous le
  // titre, seul sur sa ligne) — même déplacement que « Créer un article » (`EcranListeArticles`) et
  // « Nouvel ordre de réparation » (Atelier) : l'action principale d'un écran de liste rejoint le
  // haut du tableau, jamais l'en-tête. Ici, pas de ligne « Trier par » à partager : l'action
  // n'existe QUE quand une sélection est active (`actionCommander` reste `undefined` sinon), donc
  // sa propre ligne, alignée à droite, juste au-dessus du tableau.
  return (
    <GabaritEcran titre={t('pieces:stock.reapprovisionnement.titre')}>
      {actionCommander ? <div className="flex justify-end">{actionCommander}</div> : null}
      <TableComptoir
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => `${ligne.articleId}-${ligne.siteId}`}
        enChargement={isPending}
        onOuvrirLigne={(ligne) => navigate(chemins.pieces.articleDetail(ligne.articleId, site))}
        libelleLigne={(ligne) => t('commun:actions.ouvrirElement', { nom: ligne.designation })}
        contenuVide={
          <EtatVidePremierUsage
            titre={t('pieces:stock.reapprovisionnement.titre')}
            description={t('pieces:stock.reapprovisionnement.vide')}
          />
        }
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />
    </GabaritEcran>
  );
}

interface PropsCelluleSeuil {
  readonly ligne: LigneReapprovisionnement;
  readonly peutModifier: boolean;
}

/**
 * Saisie du seuil (#121) — `stockMinimumMillieme` est TOUJOURS défini sur les lignes de cet écran
 * (une ligne n'existe que parce qu'un seuil est posé ET dépassé, `LigneReapprovisionnement`), donc
 * le champ part toujours pré-rempli d'une valeur réelle, jamais vide par défaut d'information. Un
 * rôle en lecture seule (`!peutModifier`) voit la même valeur, sans déclencheur.
 *
 * Ferme le popover sur succès ; `useModifierStockSite` invalide déjà la liste de réapprovisionnement
 * (voir son commentaire) — la ligne disparaît d'elle-même dès que le prochain rendu constate qu'elle
 * n'est plus sous son seuil, ou que le seuil a été retiré (`RP-12`, preuve serveur du ticket).
 */
function CelluleSeuil({ ligne, peutModifier }: PropsCelluleSeuil) {
  const { t } = useTranslation(['pieces', 'commun']);
  const modifier = useModifierStockSite();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);

  if (!peutModifier) {
    return (
      <span className="tabular-nums">{formaterQuantiteMillieme(ligne.stockMinimumMillieme)}</span>
    );
  }

  function gererOuverture(prochainEtat: boolean) {
    setOuvert(prochainEtat);
    if (prochainEtat) {
      setSaisie(quantiteMilliemeVersSaisie(ligne.stockMinimumMillieme));
      setErreurSaisie(null);
      modifier.reset();
    }
  }

  function appliquer(stockMinimumMillieme: number | null) {
    modifier.mutate(
      { articleId: ligne.articleId, siteId: ligne.siteId, entree: { stockMinimumMillieme } },
      { onSuccess: () => setOuvert(false) },
    );
  }

  function enregistrer() {
    const resultat = saisieVersSeuilMillieme(saisie);
    if (resultat.genre === 'invalide') {
      setErreurSaisie(t('pieces:stock.reapprovisionnement.seuil.erreurInvalide'));
      return;
    }
    setErreurSaisie(null);
    appliquer(resultat.genre === 'absence' ? null : resultat.millieme);
  }

  const champId = `seuil-reappro-${ligne.articleId}-${ligne.siteId}`;

  return (
    <Popover open={ouvert} onOpenChange={gererOuverture}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-champ tabular-nums"
          aria-label={t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
            designation: ligne.designation,
          })}
        >
          {formaterQuantiteMillieme(ligne.stockMinimumMillieme)}
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="flex flex-col gap-controles">
          <div className="flex flex-col gap-champ">
            <Label htmlFor={champId}>{t('pieces:stock.reapprovisionnement.seuil.champ')}</Label>
            <Input
              id={champId}
              type="text"
              inputMode="decimal"
              value={saisie}
              disabled={modifier.isPending}
              onChange={(evenement) => setSaisie(evenement.target.value)}
              aria-invalid={erreurSaisie ? true : undefined}
              aria-describedby={`${champId}-aide`}
            />
            <p id={`${champId}-aide`} className="texte-libelle text-muted-foreground">
              {t('pieces:stock.reapprovisionnement.seuil.champAide')}
            </p>
          </div>

          {erreurSaisie ? (
            <p className="texte-libelle text-destructive" role="alert">
              {erreurSaisie}
            </p>
          ) : null}
          {modifier.isError ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreurMutation(modifier.error, t)}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={modifier.isPending}
              onClick={() => appliquer(null)}
            >
              {t('pieces:stock.reapprovisionnement.seuil.retirer')}
            </Button>
            <Button type="button" size="sm" disabled={modifier.isPending} onClick={enregistrer}>
              {modifier.isPending
                ? t('commun:chargement.enCours')
                : t('commun:actions.enregistrer')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
