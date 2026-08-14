import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { listerCommandesFournisseur } from '@/hooks/pieces/commandes-fournisseur.api';
import { useArticle } from '@/hooks/pieces/useArticle';
import { useFournisseur } from '@/hooks/pieces/useFournisseur';
import { useReservations } from '@/hooks/pieces/useReservations';
import {
  useMarquerObsoleteArticle,
  useDesactiverArticle,
  useReactiverArticle,
} from '@/hooks/pieces/useTransitionsArticle';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import {
  peutCreerMouvement,
  peutEcrireArticle,
  peutEcrireStockSite,
  peutLireCommandeFournisseur,
  peutLireFournisseur,
} from './droits';
import { EnTeteFicheArticle } from './EnTeteFicheArticle';
import { FormulaireArticle } from './FormulaireArticle';
import { PanneauMouvementsArticle } from './PanneauMouvementsArticle';
import { PanneauStockArticle } from './PanneauStockArticle';

type Confirmation = 'marquerObsolete' | 'desactiver' | 'reactiver' | null;

/**
 * Fiche article (RP-01 → RP-08, priorité 2 du brief) — détail, stock par site, disponibilité (via
 * `PanneauStockArticle`, déplié à la demande), historique des mouvements (`PanneauMouvementsArticle`).
 * Une seule requête PRIMAIRE bloque l'écran entier (l'article lui-même) — même architecture que
 * `EcranFicheVehicule` : chaque panneau secondaire gère son propre chargement/erreur.
 */
export function EcranFicheArticle() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const session = useSession();
  const role = session.data?.utilisateur.role;
  const sites = session.data?.sites ?? [];
  // Défaut corrigé : `pieces.fournisseur.lire`/`pieces.commande_fournisseur.lire` (direction,
  // chef_atelier, magasinier SEULS, `ecrans/pieces/droits.ts`) sont STRICTEMENT plus étroits que
  // `pieces.article.lire` qui ouvre cette fiche à `ROLES_PIECES` en entier (les sept rôles) — un
  // vendeur/réceptionnaire/technicien/comptable ouvrant une fiche article référençant un
  // fournisseur déclenchait donc systématiquement un `403` sur les deux requêtes secondaires
  // ci-dessous, rendu comme une erreur technique générique. Même doctrine que
  // `EcranFicheClient.tsx` (`peutVoirDossiersVente`) : gardé par le droit AVANT de partir, pas
  // réagi après coup sur le `403`. Tant que `session.isLoading`, `role` vaut `undefined` — ni les
  // deux `peutLire*` ci-dessous (donc aucune requête ne part encore, cf. leur usage plus bas) ni le
  // texte « droit refusé » ne doivent s'afficher avant que la session soit résolue : les deux
  // sections gardent leur squelette de chargement pendant ce court instant (voir le rendu plus
  // bas, `session.isLoading ? …`).
  const peutLireFournisseurArticle = peutLireFournisseur(role);
  const peutLireCommandesArticle = peutLireCommandeFournisseur(role);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const requeteArticle = useArticle(id);
  const marquerObsolete = useMarquerObsoleteArticle(id ?? '');
  const desactiver = useDesactiverArticle(id ?? '');
  const reactiver = useReactiverArticle(id ?? '');

  // Lot B (`docs/plan-refonte-navigation.md`) — « les OR qui l'ont consommé » et « les
  // réservations et pour quel OR ». `useReservations` (hooks/pieces/, déjà existant) accepte
  // `articleId` tel quel dans son filtre gelé (`FiltresReservations`) — une réservation
  // `satisfaite` EST la trace qu'un OR a consommé physiquement la pièce (`RP-21`, le magasinier
  // « remet PHYSIQUEMENT la pièce » à ce moment-là), une réservation `active` est une réservation
  // en cours, toutes deux DÉJÀ nommées par `ordreReparationId`.
  const requeteConsommations = useReservations({
    articleId: id,
    statut: ['satisfaite'],
    tri: 'creeLe:desc',
    limite: 20,
  });
  const requeteReservationsActives = useReservations({
    articleId: id,
    statut: ['active'],
    tri: 'creeLe:desc',
    limite: 20,
  });

  // « le fournisseur » — un article n'a pas de champ `fournisseurId` direct (`ReponseArticle`) :
  // le lien vit dans `references[].fournisseurId`, pour les entrées `type: 'fournisseur'`
  // (`RP-02`). Un article peut en porter plusieurs (multi-sourcing) ; ce lot retient la PREMIÈRE
  // trouvée — suffisant pour le geste le plus fréquent du magasinier (« qui me livre ça »), le
  // reste des références reste consultable dans la Card « Références » déjà existante ci-dessous.
  const premiereReferenceFournisseur =
    requeteArticle.data?.references.find((reference) => reference.type === 'fournisseur') ?? null;
  const fournisseurId = premiereReferenceFournisseur?.fournisseurId ?? undefined;
  const requeteFournisseur = useFournisseur(
    !session.isLoading && peutLireFournisseurArticle ? fournisseurId : undefined,
  );

  // « les commandes fournisseur en attente » — `schemaFiltresCommandesFournisseur` n'a PAS de
  // filtre `articleId` (seulement `fournisseurId`/`siteId`/`statut`/`avecReliquat`) : chaque
  // commande listée embarque déjà ses lignes complètes (`ReponseCommandeFournisseur.lignes`,
  // même doctrine que `dossiers-vente`), donc filtrée CÔTÉ CLIENT sur `lignes.some(articleId)`
  // ci-dessous plutôt que de demander un filtre serveur qui n'existe pas. `useQuery` local (pas le
  // hook `useListeCommandesFournisseur`, pagination infinie sans `enabled`) : n'interroge qu'une
  // fois `fournisseurId` connu, pour ne jamais tirer TOUTES les commandes du tenant en attendant.
  const requeteCommandes = useQuery({
    queryKey: ['article-commandes-fournisseur', id, fournisseurId],
    queryFn: () =>
      listerCommandesFournisseur(
        {
          fournisseurId: fournisseurId as string,
          avecReliquat: true,
          tri: 'creeLe:desc',
          limite: 20,
        },
        { limite: 50 },
      ),
    enabled: fournisseurId !== undefined && !session.isLoading && peutLireCommandesArticle,
  });

  if (requeteArticle.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:articles.titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requeteArticle.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:articles.titre')}</h1>
        <EtatErreur
          titre={t('pieces:articles.fiche.erreur.titre')}
          description={messageErreur(requeteArticle.error, t)}
          onReessayer={() => void requeteArticle.refetch()}
        />
      </div>
    );
  }

  const article = requeteArticle.data;
  const peutEcrire = peutEcrireArticle(role);
  const consommations = requeteConsommations.reservations;
  const reservationsActives = requeteReservationsActives.reservations;
  const commandesAvecArticle = (requeteCommandes.data?.donnees ?? []).filter((commande) =>
    commande.lignes.some((ligne) => ligne.articleId === article.id),
  );

  function confirmer() {
    if (confirmation === 'marquerObsolete') {
      marquerObsolete.mutate({}, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'desactiver') {
      desactiver.mutate({}, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'reactiver') {
      reactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    }
  }

  const enCoursTransition =
    marquerObsolete.isPending || desactiver.isPending || reactiver.isPending;
  const erreurTransition = marquerObsolete.error ?? desactiver.error ?? reactiver.error;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="sr-only">{t('pieces:articles.titre')}</h1>

      <EnTeteFicheArticle
        article={article}
        peutEcrire={peutEcrire}
        onModifier={() => setFormulaireOuvert(true)}
        onMarquerObsolete={() => setConfirmation('marquerObsolete')}
        onDesactiver={() => setConfirmation('desactiver')}
        onReactiver={() => setConfirmation('reactiver')}
      />

      {erreurTransition ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(erreurTransition, t)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:articles.references.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {article.references.length === 0 ? (
            <EtatVide
              titre={t('pieces:articles.references.titre')}
              description={t('pieces:articles.vide')}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {article.references.map((reference) => (
                <li
                  key={reference.id}
                  className="flex items-center justify-between gap-3 texte-corps"
                >
                  <span className="font-mono">{reference.reference}</span>
                  <span className="texte-libelle text-muted-foreground">
                    {t(`pieces:articles.references.types.${reference.type}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — le fournisseur (magasinier : « le lien qui manque le plus tous les jours »). */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:articles.fiche.fournisseur.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fournisseurId === undefined ? (
            <EtatVide
              titre={t('pieces:articles.fiche.fournisseur.titre')}
              description={t('pieces:articles.fiche.fournisseur.vide')}
            />
          ) : session.isLoading ? (
            <EtatChargement lignes={1} />
          ) : !peutLireFournisseurArticle ? (
            <p className="texte-corps text-muted-foreground">
              {t('pieces:articles.fiche.fournisseur.droitRequis')}
            </p>
          ) : requeteFournisseur.isPending ? (
            <EtatChargement lignes={1} />
          ) : requeteFournisseur.isError ? (
            <EtatErreur
              titre={t('pieces:articles.fiche.erreurSection.titre')}
              description={messageErreur(requeteFournisseur.error, t)}
              onReessayer={() => void requeteFournisseur.refetch()}
            />
          ) : (
            <button
              type="button"
              className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => navigate(chemins.pieces.fournisseurs.detail(fournisseurId))}
            >
              {requeteFournisseur.data.nom}
            </button>
          )}
        </CardContent>
      </Card>

      {/* Lot B — commandes fournisseur en attente pour cet article. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:articles.fiche.commandesFournisseur.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fournisseurId === undefined ? (
            <EtatVide
              titre={t('pieces:articles.fiche.commandesFournisseur.titre')}
              description={t('pieces:articles.fiche.commandesFournisseur.sansFournisseur')}
            />
          ) : session.isLoading ? (
            <EtatChargement lignes={2} />
          ) : !peutLireCommandesArticle ? (
            <p className="texte-corps text-muted-foreground">
              {t('pieces:articles.fiche.commandesFournisseur.droitRequis')}
            </p>
          ) : requeteCommandes.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteCommandes.isError ? (
            <EtatErreur
              titre={t('pieces:articles.fiche.erreurSection.titre')}
              description={messageErreur(requeteCommandes.error, t)}
              onReessayer={() => void requeteCommandes.refetch()}
            />
          ) : commandesAvecArticle.length === 0 ? (
            <EtatVide
              titre={t('pieces:articles.fiche.commandesFournisseur.titre')}
              description={t('pieces:articles.fiche.commandesFournisseur.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {commandesAvecArticle.map((commande) => (
                <li key={commande.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() =>
                      navigate(chemins.pieces.commandesFournisseur.detail(commande.id))
                    }
                  >
                    {commande.reference ?? formaterDate(commande.dateCommande)}
                  </button>
                  <span className="texte-libelle text-muted-foreground">
                    {t(`pieces:commandes.statuts.${commande.statut}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — réservations en cours, pour quel OR. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:articles.fiche.reservationsActives.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requeteReservationsActives.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteReservationsActives.isError ? (
            <EtatErreur
              titre={t('pieces:articles.fiche.erreurSection.titre')}
              description={messageErreur(requeteReservationsActives.error, t)}
              onReessayer={() => void requeteReservationsActives.refetch()}
            />
          ) : reservationsActives.length === 0 ? (
            <EtatVide
              titre={t('pieces:articles.fiche.reservationsActives.titre')}
              description={t('pieces:articles.fiche.reservationsActives.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {reservationsActives.map((reservation) => (
                <li key={reservation.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() =>
                      navigate(
                        chemins.atelier.ordresReparation.detail(
                          reservation.ordreReparationId,
                          site,
                        ),
                      )
                    }
                  >
                    {t('pieces:articles.fiche.reservationsActives.lien')}
                  </button>
                  <span className="texte-libelle tabular-nums text-muted-foreground">
                    {(reservation.quantiteMillieme / 1000).toString()} ·{' '}
                    {formaterDate(reservation.creeLe)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — les OR qui ont consommé cet article. */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('pieces:articles.fiche.consommateurs.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requeteConsommations.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteConsommations.isError ? (
            <EtatErreur
              titre={t('pieces:articles.fiche.erreurSection.titre')}
              description={messageErreur(requeteConsommations.error, t)}
              onReessayer={() => void requeteConsommations.refetch()}
            />
          ) : consommations.length === 0 ? (
            <EtatVide
              titre={t('pieces:articles.fiche.consommateurs.titre')}
              description={t('pieces:articles.fiche.consommateurs.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {consommations.map((reservation) => (
                <li key={reservation.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() =>
                      navigate(
                        chemins.atelier.ordresReparation.detail(
                          reservation.ordreReparationId,
                          site,
                        ),
                      )
                    }
                  >
                    {t('pieces:articles.fiche.consommateurs.lien')}
                  </button>
                  <span className="texte-libelle tabular-nums text-muted-foreground">
                    {(reservation.quantiteMillieme / 1000).toString()} ·{' '}
                    {reservation.satisfaiteLe ? formaterDate(reservation.satisfaiteLe) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PanneauStockArticle
        articleId={article.id}
        stocksResume={article.stocksResume}
        sites={sites}
        peutModifierStock={peutEcrireStockSite(role)}
      />

      <PanneauMouvementsArticle
        articleId={article.id}
        sites={sites}
        peutCreerMouvement={peutCreerMouvement(role)}
        siteParDefaut={site}
      />

      {peutEcrire ? (
        <FormulaireArticle
          ouvert={formulaireOuvert}
          onOuvertChange={setFormulaireOuvert}
          article={article}
        />
      ) : null}

      <AvertissementConfirmable
        ouvert={confirmation !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setConfirmation(null);
        }}
        titre={confirmation ? t(`pieces:articles.confirmations.${confirmation}Titre`) : ''}
        description={
          confirmation ? t(`pieces:articles.confirmations.${confirmation}Description`) : ''
        }
        libelleConfirmation={confirmation ? t(`pieces:articles.actions.${confirmation}`) : ''}
        onConfirmer={confirmer}
        enCours={enCoursTransition}
      />
    </div>
  );
}
