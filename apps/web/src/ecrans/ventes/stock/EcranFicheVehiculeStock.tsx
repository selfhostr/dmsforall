import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';

import type { StatutCommercialVehicule } from '@dfa/shared';
import { PROVENANCES_VEHICULE_STOCK } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
import { useSession } from '@/hooks/useSession';
import {
  useMarquerVenduVehiculeStock,
  useReceptionnerVehiculeStock,
  useRemettreDisponibleVehiculeStock,
} from '@/hooks/ventes/stock/useTransitionsVehiculeStock';
import { useVehiculeStock } from '@/hooks/ventes/stock/useVehiculeStock';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { ValeurConfidentielle } from '../_composants/ValeurConfidentielle';
import {
  BasculeVueStock,
  lireVueAffichageStock,
  type VueAffichageStock,
} from './_composants/BasculeVueStock';
import { DialogueActionAvecMotif } from './_composants/DialogueActionAvecMotif';
import { FormulaireVehiculeStock } from './_composants/FormulaireVehiculeStock';
import { peutCorrigerVehiculeStock, peutEcrireVehiculeStock } from './droits';

const VARIANTE_BADGE_STATUT: Record<StatutCommercialVehicule, 'default' | 'secondary' | 'outline'> =
  {
    en_commande: 'outline',
    disponible: 'default',
    reserve: 'secondary',
    vendu: 'secondary',
    livre: 'secondary',
  };

function texteDate(valeur: string | null): string {
  return valeur === null ? '—' : formaterDate(valeur);
}

/**
 * Fiche COMMERCIALE d'un véhicule en stock (`/ventes/stock/{id}`, `EcranFicheVehiculeStock`) —
 * DÉCISION DE NAVIGATION déjà actée (voir docs/design-ecrans-ventes.md et le brief de livraison
 * de cet agent) : `EcranFicheVehicule.tsx` (`/vehicules/{id}`, hors périmètre de cet agent) reste
 * L'écran unique de la fiche véhicule technique, y compris pour un véhicule en stock, via une
 * section `BlocVente` future — PAS remplacée ici. Cet écran est donc un COMPLÉMENT, pas un
 * doublon : il affiche l'identité véhicule en LECTURE SEULE (`IdentiteVehicule`, à partir de
 * `ReponseVehiculeStock.vehicule`) + toutes les données commerciales/stock (prix, statut,
 * historique, actions), avec un lien explicite vers la fiche véhicule complète pour tout ce qui
 * est technique/atelier.
 *
 * DÉCISION DE CONCEPTION signalée au rapport de livraison : le sort à terme de cet écran
 * (fusionné dans `BlocVente` ou maintenu séparé) appartient à la session principale — cet agent
 * ne pouvait pas trancher sans le périmètre `BlocVente`, confié à un autre travail.
 *
 * Une seule requête PRIMAIRE bloque l'écran entier (la fiche stock elle-même) — même
 * architecture que `EcranFicheArticle`/`EcranFicheVehicule`.
 */
export function EcranFicheVehiculeStock() {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  // Vue client (issue #84) : quand cette fiche est ouverte depuis la liste en vue client (bouton
  // « Fiche commerciale », voir `EcranListeVehiculesStock.cheminFicheCommerciale`), le mode suit
  // dans l'URL — pas de bascule séparée à refaire à chaque fiche pendant qu'un client regarde
  // encore l'écran. Reste bien sûr changeable ici aussi (`BasculeVueStock` ci-dessous).
  const vue = lireVueAffichageStock(searchParams);

  function definirVue(valeur: VueAffichageStock) {
    const parametres = new URLSearchParams(searchParams);
    if (valeur === 'client') {
      parametres.set('vue', 'client');
    } else {
      parametres.delete('vue');
    }
    setSearchParams(parametres);
  }

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [remettreDisponibleOuvert, setRemettreDisponibleOuvert] = useState(false);
  const [marquerVenduOuvert, setMarquerVenduOuvert] = useState(false);
  const [confirmationReceptionOuverte, setConfirmationReceptionOuverte] = useState(false);

  // Prix d'achat / frais de remise en état : en vue client (issue #84), ces deux lignes ne sont
  // plus rendues DU TOUT — voir plus bas — donc rien à masquer ni à révéler ici. En vue vendeur
  // (défaut), restent masquées par défaut (constat testeur : juxtaposées au prix de vente, elles
  // révèlent la marge) — PAS une mesure de sécurité, une protection contre le regard par-dessus
  // l'épaule pour l'usage privé au bureau. Remis à `false` non seulement au montage mais aussi à
  // chaque CHANGEMENT d'`id` OU de `vue` : react-router ne démonte pas cet écran quand on navigue
  // d'une fiche véhicule à une autre (même route, seul `:id` change), un simple `useState(false)`
  // resterait donc révélé pour le véhicule suivant, ou en repassant en vue vendeur, sans ce reset.
  const [prixConfidentielsReveles, setPrixConfidentielsReveles] = useState(false);
  useEffect(() => {
    setPrixConfidentielsReveles(false);
  }, [id, vue]);

  const requeteStock = useVehiculeStock(id);
  const receptionner = useReceptionnerVehiculeStock(id ?? '');
  const remettreDisponible = useRemettreDisponibleVehiculeStock(id ?? '');
  const marquerVendu = useMarquerVenduVehiculeStock(id ?? '');

  // Défaut corrigé : la fermeture (annulation ou clic hors modale) réinitialise l'erreur — même
  // patron que `DialogueActionAvecMotif.fermer` — pour qu'un échec du jeu précédent ne réapparaisse
  // pas silencieusement sous l'overlay à la prochaine ouverture.
  function fermerConfirmationReception(ouvertSuivant: boolean) {
    if (!ouvertSuivant) receptionner.reset();
    setConfirmationReceptionOuverte(ouvertSuivant);
  }

  if (requeteStock.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:stock.fiche.titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requeteStock.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:stock.fiche.titre')}</h1>
        <EtatErreur
          titre={t('ventes:stock.fiche.erreur.titre')}
          description={messageErreur(requeteStock.error, t)}
          onReessayer={() => void requeteStock.refetch()}
        />
      </div>
    );
  }

  const stock = requeteStock.data;
  const peutEcrire = peutEcrireVehiculeStock(role);
  const peutCorriger = peutCorrigerVehiculeStock(role);

  const proposeMettreAJour = peutEcrire && stock.actionsDisponibles.includes('mettre_a_jour');
  const proposeReceptionner = peutEcrire && stock.actionsDisponibles.includes('receptionner');
  const proposeRemettreDisponible =
    peutCorriger && stock.actionsDisponibles.includes('remettre_disponible');
  /** `marquer_vendu` — AJOUTÉ après le premier gel de `ACTIONS_VEHICULE_STOCK` (@dfa/shared,
   *  voir enums.ts) : correction exceptionnelle `reserve -> vendu`, même droit et même forme de
   *  corps (`{ motif }`) que `remettre_disponible` — voir `peutCorrigerVehiculeStock`. */
  const proposeMarquerVendu = peutCorriger && stock.actionsDisponibles.includes('marquer_vendu');

  // Lot C (`docs/plan-refonte-navigation.md`) — action primaire unique, même patron que
  // `EnTeteOrdreReparation`/`EnTeteDossierVente`/`EnTeteFicheArticle` : `stock.actionsDisponibles`
  // gouverne, rien n'est redeviné depuis `statutCommercial`. La seule transition d'AVANCEMENT de ce
  // cycle avec un déclencheur simple (dialogue de confirmation nue, sans formulaire — même famille
  // que `preparer`/`marquer_pret_a_livrer`/`cloturer` sur le dossier de vente) est `receptionner` :
  // promue en primaire dès qu'elle est disponible. Sinon `mettre_a_jour` (l'édition de la fiche de
  // coût, présente sur tous les statuts hors `vendu`/`livre`, verrouillé) devient la primaire par
  // défaut — même rôle que « Modifier » sur `EnTeteFicheArticle`. Les corrections exceptionnelles
  // (`remettre_disponible`/`marquer_vendu`) ne sont JAMAIS primaires, toujours dans le menu de
  // débordement.
  const actionPrimaire = proposeReceptionner
    ? {
        cle: 'receptionner' as const,
        libelle: t('ventes:stock.fiche.actions.receptionner'),
        onClick: () => setConfirmationReceptionOuverte(true),
      }
    : proposeMettreAJour
      ? {
          cle: 'mettreAJour' as const,
          libelle: t('ventes:stock.fiche.actions.mettreAJour'),
          onClick: () => setFormulaireOuvert(true),
        }
      : null;

  const actionsSecondaires: ActionSecondaireMenu[] = [
    actionPrimaire?.cle !== 'mettreAJour' && proposeMettreAJour
      ? {
          cle: 'mettreAJour',
          libelle: t('ventes:stock.fiche.actions.mettreAJour'),
          onSelect: () => setFormulaireOuvert(true),
        }
      : null,
    proposeRemettreDisponible
      ? {
          cle: 'remettreDisponible',
          libelle: t('ventes:stock.fiche.actions.remettreDisponible'),
          onSelect: () => setRemettreDisponibleOuvert(true),
        }
      : null,
    proposeMarquerVendu
      ? {
          cle: 'marquerVendu',
          libelle: t('ventes:stock.fiche.actions.marquerVendu'),
          onSelect: () => setMarquerVenduOuvert(true),
        }
      : null,
  ].filter((action): action is ActionSecondaireMenu => action !== null);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="sr-only">{t('ventes:stock.fiche.titre')}</h1>

      {/* Bascule vue vendeur/client (issue #84) — voir `BasculeVueStock` pour la doctrine
          complète. Placée avant tout le reste : c'est le premier geste avant de tourner l'écran
          vers un client. */}
      <BasculeVueStock vue={vue} onChangeVue={definirVue} />

      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <IdentiteVehicule
              vehicule={
                vue === 'client'
                  ? { ...stock.vehicule, identificationIncomplete: false }
                  : stock.vehicule
              }
              taillePlaque="xl"
            />
            <Badge variant={VARIANTE_BADGE_STATUT[stock.statutCommercial]}>
              {t(`ventes:stock.statuts.${stock.statutCommercial}`)}
            </Badge>
          </div>
          <p className="texte-corps text-muted-foreground">
            {t(`ventes:stock.types.${stock.typeVehicule}`)}
          </p>
          <Link
            to={chemins.vehicules.detail(stock.id, site)}
            className="texte-corps text-primary underline-offset-4 hover:underline"
          >
            {t('ventes:stock.fiche.voirFicheVehicule')}
          </Link>
        </div>

        {/* Actions internes (mettre à jour, réceptionner, corrections) retirées en vue client :
            pas de geste d'écriture accessible pendant qu'un client regarde l'écran. */}
        {vue === 'vendeur' && actionPrimaire ? (
          <ActionPrimaire
            actionsSecondaires={actionsSecondaires}
            libelleMenuSecondaire={t('ventes:stock.fiche.actions.autresActions')}
          >
            <Button type="button" variant="default" onClick={actionPrimaire.onClick}>
              {actionPrimaire.libelle}
            </Button>
          </ActionPrimaire>
        ) : null}
      </div>

      {vue === 'client' ? (
        // Vue client (issue #84) : provenance, ancienneté, prix d'achat, frais de remise en état
        // et assujettissement TVA du vendeur précédent ne sont PAS rendus — ni masqués ni
        // révélables, absents du DOM. Seul ce qui aide un client à décider reste : le véhicule,
        // son statut, son prix de vente, mis en avant plutôt qu'englouti dans un tableau de
        // données commerciales qui n'a plus grand-chose à montrer une fois la marge retirée.
        <Card>
          <CardContent className="p-6">
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:stock.champs.prixVenteAffiche')}
            </p>
            <p className="texte-donnee-proeminente">
              {stock.prixVenteAfficheCentimes === null
                ? t('ventes:stock.prixNonFixe')
                : formaterMontant(stock.prixVenteAfficheCentimes)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('ventes:stock.fiche.donneesCommerciales')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 texte-corps sm:grid-cols-3">
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.provenance')}
                  </dt>
                  <dd>
                    {PROVENANCES_VEHICULE_STOCK.includes(
                      stock.provenance as (typeof PROVENANCES_VEHICULE_STOCK)[number],
                    )
                      ? t(`ventes:stock.provenances.${stock.provenance}`)
                      : stock.provenance}
                  </dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.dateEntreeStock')}
                  </dt>
                  <dd>{formaterDate(stock.dateEntreeStock)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.joursStock')}
                  </dt>
                  <dd className="tabular-nums">{stock.joursStock}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.prixAchat')}
                  </dt>
                  <dd className="tabular-nums font-medium">
                    <ValeurConfidentielle
                      revele={prixConfidentielsReveles}
                      onToggle={() => setPrixConfidentielsReveles((valeur) => !valeur)}
                      valeur={formaterMontant(stock.prixAchatCentimes)}
                      nomChamp={t('ventes:stock.champs.prixAchat')}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.fraisRemiseEtatCumules')}
                  </dt>
                  <dd className="tabular-nums">
                    <ValeurConfidentielle
                      revele={prixConfidentielsReveles}
                      onToggle={() => setPrixConfidentielsReveles((valeur) => !valeur)}
                      valeur={formaterMontant(stock.fraisRemiseEtatCumulesCentimes)}
                      nomChamp={t('ventes:stock.champs.fraisRemiseEtatCumules')}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.prixVenteAffiche')}
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {stock.prixVenteAfficheCentimes === null
                      ? t('ventes:stock.prixNonFixe')
                      : formaterMontant(stock.prixVenteAfficheCentimes)}
                  </dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.vendeurPrecedentAssujetti')}
                  </dt>
                  <dd>
                    {stock.vendeurPrecedentAssujetti === null
                      ? t('ventes:stock.assujetti.nonRenseigne')
                      : stock.vendeurPrecedentAssujetti
                        ? t('ventes:stock.assujetti.oui')
                        : t('ventes:stock.assujetti.non')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('ventes:stock.fiche.historique')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 texte-corps sm:grid-cols-4">
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.receptionneLe')}
                  </dt>
                  <dd>{texteDate(stock.receptionneLe)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.reserveLe')}
                  </dt>
                  <dd>{texteDate(stock.reserveLe)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.venduLe')}
                  </dt>
                  <dd>{texteDate(stock.venduLe)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('ventes:stock.champs.livreLe')}
                  </dt>
                  <dd>{texteDate(stock.livreLe)}</dd>
                </div>
              </dl>
              <p className="mt-3 texte-libelle text-muted-foreground">
                {t('ventes:stock.fiche.creeLe')} {formaterDate(stock.creeLe)} ·{' '}
                {t('ventes:stock.fiche.modifieLe')} {formaterDate(stock.modifieLe)}
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {formulaireOuvert ? (
        <FormulaireVehiculeStock
          ouvert={formulaireOuvert}
          onOuvertChange={setFormulaireOuvert}
          stock={stock}
        />
      ) : null}

      {remettreDisponibleOuvert ? (
        <DialogueActionAvecMotif
          ouvert={remettreDisponibleOuvert}
          onOuvertChange={setRemettreDisponibleOuvert}
          titre={t('ventes:stock.fiche.actions.remettreDisponible')}
          description={t('ventes:stock.fiche.remettreDisponibleDescription')}
          libelleConfirmation={t('ventes:stock.fiche.actions.remettreDisponible')}
          mutation={remettreDisponible}
        />
      ) : null}

      {marquerVenduOuvert ? (
        <DialogueActionAvecMotif
          ouvert={marquerVenduOuvert}
          onOuvertChange={setMarquerVenduOuvert}
          titre={t('ventes:stock.fiche.actions.marquerVendu')}
          description={t('ventes:stock.fiche.marquerVenduDescription')}
          libelleConfirmation={t('ventes:stock.fiche.actions.marquerVendu')}
          mutation={marquerVendu}
        />
      ) : null}

      {/* Construit à la main (plutôt que `AvertissementConfirmable`, qui n'a pas d'emplacement pour
          une erreur) précisément pour corriger le défaut signalé : l'erreur de la mutation
          « réceptionner » s'affichait auparavant HORS du contenu du dialogue, donc invisible sous
          l'overlay tant que la modale restait ouverte — même doctrine que `DialogueActionAvecMotif`
          dans ce même écran (erreur affichée DANS la modale). */}
      <Dialog open={confirmationReceptionOuverte} onOpenChange={fermerConfirmationReception}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 h-5 w-5 shrink-0 text-statut-attention"
              />
              <DialogTitle>{t('ventes:stock.fiche.actions.receptionner')}</DialogTitle>
            </div>
            <DialogDescription>{t('ventes:stock.fiche.receptionnerDescription')}</DialogDescription>
          </DialogHeader>

          {receptionner.error ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(receptionner.error, t)}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={receptionner.isPending}>
                {t('commun:actions.annuler')}
              </Button>
            </DialogClose>
            <Button
              disabled={receptionner.isPending}
              onClick={() =>
                receptionner.mutate({}, { onSuccess: () => setConfirmationReceptionOuverte(false) })
              }
            >
              {t('ventes:stock.fiche.actions.receptionner')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
