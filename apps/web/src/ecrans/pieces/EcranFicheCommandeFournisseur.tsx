import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { AideContextuelle } from '@/composants/AideContextuelle';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useCommandeFournisseur } from '@/hooks/pieces/useCommandeFournisseur';
import { useFournisseur } from '@/hooks/pieces/useFournisseur';
import {
  useAnnulerCommandeFournisseur,
  useAnnulerReliquatLigneCommande,
  useEnvoyerCommandeFournisseur,
} from '@/hooks/pieces/useTransitionsCommandeFournisseur';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterDateHeure, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutCommandeFournisseur } from './BadgeStatutCommandeFournisseur';
import { DialogueMotifCommandeFournisseur } from './DialogueMotifCommandeFournisseur';
import { DialogueReceptionCommande } from './DialogueReceptionCommande';
import {
  peutEcrireCommandeFournisseur,
  peutLireCommandeFournisseur,
  peutReceptionnerCommandeFournisseur,
} from './droits';
import { messageErreurMutation } from './messages-erreur-mutation';
import { formaterQuantiteMillieme, texteOuVide } from './utils';

type Confirmation =
  | { readonly type: 'annuler' }
  | { readonly type: 'annulerReliquat'; readonly ligneId: string }
  | null;

/**
 * Fiche commande fournisseur (RP-26 → RP-31, §6.2, priorité 1 du lot) — lignes, quantités
 * commandées/reçues/reliquat, montants attendus, et les 4 transitions nommées du contrat
 * (`envoyer`, `reception`, `annuler-reliquat`, `annuler`). Même architecture que
 * `EcranFicheArticle` : une seule requête PRIMAIRE bloque l'écran, `useFournisseur` est une
 * requête SECONDAIRE (juste le nom, jamais bloquante à elle seule).
 */
export function EcranFicheCommandeFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const actions = session.data?.actions;
  const sites = session.data?.sites ?? [];
  const peutLire = peutLireCommandeFournisseur(actions);

  const [receptionOuverte, setReceptionOuverte] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  // Défaut corrigé : `pieces.commande_fournisseur.lire` (direction/chef_atelier/magasinier SEULS)
  // est STRICTEMENT plus étroit que `ROLES_PIECES` qui protège la ROUTE
  // `/pieces/commandes-fournisseur/:id` (les sept rôles) — un vendeur/réceptionnaire/technicien/
  // comptable qui l'atteignait (menu masqué mais URL directe toujours accessible, doctrine
  // documentée en tête de `routes/droits-routes.ts`) déclenchait un `403` rendu comme une erreur
  // technique générique. Même doctrine que `EcranFicheClient.tsx` (`peutVoirDossiersVente`) :
  // gardé par le droit AVANT de partir. `useFournisseur` en aval ne peut jamais être refusé pour
  // un rôle qui a passé cette garde : `peutLireCommandeFournisseur`/`peutLireFournisseur`
  // partagent EXACTEMENT le même trio de rôles (`ecrans/pieces/droits.ts`).
  const requeteCommande = useCommandeFournisseur(session.isLoading || !peutLire ? undefined : id);
  const commande = requeteCommande.data;
  const requeteFournisseur = useFournisseur(commande?.fournisseurId);

  const envoyer = useEnvoyerCommandeFournisseur(id ?? '');
  const annuler = useAnnulerCommandeFournisseur(id ?? '');
  const annulerReliquat = useAnnulerReliquatLigneCommande(id ?? '');

  if (session.isLoading) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (!peutLire) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <p className="texte-corps text-muted-foreground">
          {t('pieces:commandes.fiche.droitRequis')}
        </p>
      </GabaritEcran>
    );
  }

  if (requeteCommande.isPending) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requeteCommande.isError || !commande) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <EtatErreur
          titre={t('pieces:commandes.fiche.erreur.titre')}
          description={messageErreur(requeteCommande.error, t)}
          onReessayer={() => void requeteCommande.refetch()}
        />
      </GabaritEcran>
    );
  }

  const nomSite = sites.find((site) => site.id === commande.siteId)?.nom ?? commande.siteId;
  const nomFournisseur = requeteFournisseur.data?.nom;

  const peutEcrire = peutEcrireCommandeFournisseur(actions);
  const peutReceptionner = peutReceptionnerCommandeFournisseur(actions);
  const peutEnvoyer = peutEcrire && commande.statut === 'brouillon';
  const peutAnnulerCommande =
    peutEcrire && (commande.statut === 'brouillon' || commande.statut === 'envoyee');
  const peutOuvrirReception =
    peutReceptionner &&
    (commande.statut === 'envoyee' || commande.statut === 'partiellement_recue');

  const erreurTransition = envoyer.error ?? annuler.error ?? annulerReliquat.error;

  const totalAttenduCentimes = commande.lignes.reduce<number | null>((total, ligne) => {
    if (ligne.prixAchatAttenduCentimes === null) return total;
    const montantLigne = Math.round(
      (ligne.prixAchatAttenduCentimes * ligne.quantiteCommandeeMillieme) / 1000,
    );
    return (total ?? 0) + montantLigne;
  }, null);
  const totalIncomplet = commande.lignes.some((ligne) => ligne.prixAchatAttenduCentimes === null);

  // Fil d'Ariane contextuel (même doctrine que `EnTeteFicheArticle`, Lot C) — un seul ancêtre
  // honnête : la liste des commandes fournisseur dont cette fiche vient. Ressource par TENANT
  // (pas de `?site=`, voir `chemins.pieces.commandesFournisseur`). Identité affichée = celle du
  // `<h2>` ci-dessous (référence si connue, sinon la date), même règle que `libelleLigne` de
  // `EcranListeCommandesFournisseur`.
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    {
      cle: 'commandes',
      libelle: t('pieces:commandes.titre'),
      href: chemins.pieces.commandesFournisseur.liste(),
    },
  ];

  // Titre MASQUÉ automatiquement — « Commandes fournisseur » (titre générique de la fiche,
  // identité RÉELLE portée par le `<h2>` visible ci-dessous, la date de la commande) est un
  // doublon de la vue active « Commandes » : `GabaritEcran` le détecte lui-même. Un seul `<h1>`
  // par page (accessibilité) — jamais deux niveaux 1 en compétition.
  return (
    <GabaritEcran titre={t('pieces:commandes.titre')}>
      {/* Bordure décorative retirée (DESIGN.md « bordure structurelle uniquement ») — simple
          groupe de contenu (identité + statut + métadonnées), sans comportement propre. Devient
          une vraie `Card` (surface seule), même traitement que `EnTeteFicheArticle.tsx`. */}
      <Card>
        <CardContent className="flex flex-col gap-groupe pt-carte">
          <FilAriane
            segments={segmentsFilAriane}
            pageCourante={commande.reference ?? formaterDate(commande.dateCommande)}
          />

          <div className="flex flex-col gap-groupe sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-champ">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="texte-titre-page">{formaterDate(commande.dateCommande)}</h2>
                <BadgeStatutCommandeFournisseur statut={commande.statut} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-champ texte-corps sm:grid-cols-3">
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.fournisseur')}
                  </dt>
                  <dd>
                    {nomFournisseur ? (
                      <Link
                        to={`/pieces/fournisseurs/${commande.fournisseurId}`}
                        className="text-primary underline"
                      >
                        {nomFournisseur}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.site')}
                  </dt>
                  <dd>{nomSite}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.origine')}
                  </dt>
                  <dd>{t(`pieces:commandes.origines.${commande.origine}`)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.reference')}
                  </dt>
                  <dd>{texteOuVide(commande.reference)}</dd>
                </div>
                {commande.envoyeeLe ? (
                  <div>
                    <dt className="texte-libelle text-muted-foreground">
                      {t('pieces:commandes.envoyeeLe')}
                    </dt>
                    <dd>{formaterDateHeure(commande.envoyeeLe)}</dd>
                  </div>
                ) : null}
                {totalAttenduCentimes !== null ? (
                  <div>
                    <dt className="texte-libelle text-muted-foreground">
                      {t('pieces:commandes.montantAttendu')}
                    </dt>
                    <dd className="tabular-nums font-medium">
                      {formaterMontant(totalAttenduCentimes)}
                      {totalIncomplet ? (
                        <span className="ml-1 texte-libelle text-muted-foreground">
                          {t('pieces:commandes.montantPartiel')}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {commande.statut === 'annulee' && commande.motifAnnulation ? (
                <p className="mt-2 texte-corps text-destructive">
                  {t('pieces:commandes.motifAnnulation')} : {commande.motifAnnulation}
                </p>
              ) : null}
            </div>

            {peutEnvoyer || peutOuvrirReception || peutAnnulerCommande ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    {t('commun:actions.modifier')}
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {peutEnvoyer ? (
                    <DropdownMenuItem
                      disabled={envoyer.isPending}
                      onSelect={() => envoyer.mutate(undefined)}
                    >
                      {envoyer.isPending
                        ? t('commun:chargement.enCours')
                        : t('pieces:commandes.actions.envoyer')}
                    </DropdownMenuItem>
                  ) : null}
                  {peutOuvrirReception ? (
                    <DropdownMenuItem onSelect={() => setReceptionOuverte(true)}>
                      {t('pieces:commandes.actions.receptionner')}
                    </DropdownMenuItem>
                  ) : null}
                  {peutAnnulerCommande ? (
                    <DropdownMenuItem onSelect={() => setConfirmation({ type: 'annuler' })}>
                      {t('pieces:commandes.actions.annuler')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {erreurTransition ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreurMutation(erreurTransition, t)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:commandes.lignes.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-controles">
          {commande.lignes.map((ligne) => (
            // Bordure retirée (DESIGN.md) : cette ligne vit déjà dans la `Card` « Lignes » —
            // un cadre par ligne à l'intérieur d'une surface déjà distincte du fond de page
            // recréait la « carte dans une carte ». Surface tonale à la place, même mécanisme
            // que `EnTeteOrdreReparation.tsx` (atelier) pour un bloc lecture seule sans
            // comportement propre.
            <div
              key={ligne.id}
              className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 texte-corps"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/pieces/articles/${ligne.articleId}`}
                  className="font-medium text-primary underline"
                >
                  {t('pieces:commandes.lignes.article')} {ligne.numeroOrdre}
                </Link>
                {ligne.quantiteReliquatMillieme > 0 &&
                ligne.reliquatAnnuleLe === null &&
                peutReceptionner ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmation({ type: 'annulerReliquat', ligneId: ligne.id })}
                  >
                    {t('pieces:commandes.actions.annulerReliquat')}
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <div>
                  <span className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.lignes.quantiteCommandee')}
                  </span>
                  <p className="tabular-nums">
                    {formaterQuantiteMillieme(ligne.quantiteCommandeeMillieme)}
                  </p>
                </div>
                <div>
                  <span className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.lignes.quantiteRecue')}
                  </span>
                  <p className="tabular-nums">
                    {formaterQuantiteMillieme(ligne.quantiteRecueCumuleeMillieme)}
                  </p>
                </div>
                <div>
                  <span className="flex items-center gap-1.5 texte-libelle text-muted-foreground">
                    {t('pieces:commandes.lignes.quantiteReliquat')}
                    <AideContextuelle
                      sujet={t('pieces:commandes.lignes.quantiteReliquat')}
                      texte={t('aide:pieces.reliquat')}
                    />
                  </span>
                  <p className="tabular-nums">
                    {formaterQuantiteMillieme(ligne.quantiteReliquatMillieme)}
                    {ligne.reliquatAnnuleLe !== null ? (
                      <span className="ml-1 texte-libelle text-muted-foreground">
                        ({t('pieces:commandes.lignes.reliquatAnnule')})
                      </span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <span className="texte-libelle text-muted-foreground">
                    {t('pieces:commandes.lignes.prixAchatAttendu')}
                  </span>
                  <p className="tabular-nums">
                    {ligne.prixAchatAttenduCentimes === null
                      ? '—'
                      : formaterMontant(ligne.prixAchatAttenduCentimes)}
                  </p>
                </div>
              </div>
              {ligne.reliquatMotifAnnulation ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('pieces:commandes.lignes.motif')} : {ligne.reliquatMotifAnnulation}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <DialogueReceptionCommande
        ouvert={receptionOuverte}
        onOuvertChange={setReceptionOuverte}
        commande={commande}
      />

      <DialogueMotifCommandeFournisseur
        ouvert={confirmation?.type === 'annuler'}
        titre={t('pieces:commandes.confirmations.annulerTitre')}
        description={t('pieces:commandes.confirmations.annulerDescription')}
        libelleAction={t('pieces:commandes.actions.annuler')}
        enCours={annuler.isPending}
        erreur={annuler.error}
        onFermer={() => setConfirmation(null)}
        onConfirmer={(motif) =>
          annuler.mutate({ motif }, { onSuccess: () => setConfirmation(null) })
        }
      />

      <DialogueMotifCommandeFournisseur
        ouvert={confirmation?.type === 'annulerReliquat'}
        titre={t('pieces:commandes.confirmations.annulerReliquatTitre')}
        description={t('pieces:commandes.confirmations.annulerReliquatDescription')}
        libelleAction={t('pieces:commandes.actions.annulerReliquat')}
        enCours={annulerReliquat.isPending}
        erreur={annulerReliquat.error}
        onFermer={() => setConfirmation(null)}
        onConfirmer={(motif) => {
          if (confirmation?.type !== 'annulerReliquat') return;
          annulerReliquat.mutate(
            { ligneId: confirmation.ligneId, entree: { motif } },
            { onSuccess: () => setConfirmation(null) },
          );
        }}
      />
    </GabaritEcran>
  );
}
