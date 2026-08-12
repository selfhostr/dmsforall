import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { FiltresDocumentsVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';
import { peutCreerLigneOr } from './droits';
import { EnTeteOrdreReparation } from './EnTeteOrdreReparation';
import { ListeLignesOrdreReparation } from './ListeLignesOrdreReparation';
import { PanneauActionsOr } from './PanneauActionsOr';

/** Centièmes d'heure -> "1.50 h" — même formateur local que `ListeLignesOrdreReparation.tsx`
 *  (aucun helper partagé dans `lib/formats.ts` pour une durée de pointage, seulement pour
 *  montants/kilométrages/dates), dupliqué ici plutôt qu'importé d'un fichier hors périmètre. */
function formaterTempsHeures(centiemes: number): string {
  return `${(centiemes / 100).toFixed(2)} h`;
}

/** `TypeDocumentVente` -> suffixe de `facturation:document.type` — même mapping que
 *  `CarteDocumentsVente.tsx` (`ecrans/ventes/dossiers/`, hors périmètre), dupliqué ici plutôt
 *  qu'importé : ce fichier n'a pas vocation à dépendre du module ventes pour un simple libellé. */
function cleTypeDocumentVente(typeDocument: string, natureFacture: string | null): string {
  if (typeDocument === 'bon_commande') return 'bonCommande';
  if (typeDocument === 'facture' && natureFacture === 'acompte') return 'factureAcompte';
  return typeDocument;
}

/**
 * Fiche d'un ordre de réparation — le cœur du produit : en-tête (véhicule/client/statut), lignes
 * de travail, totaux, et les actions RÉELLEMENT disponibles pour l'appelant courant
 * (`or.actionsDisponibles`, §7.7 — jamais une liste devinée depuis le statut, voir
 * `PanneauActionsOr`). `GET /ordres-reparation/{id}` renvoie le DOCUMENT COMPLET (D-10) : une
 * seule requête bloque l'écran entier, aucune sous-requête secondaire à gérer séparément.
 *
 * `:orId` — convention assumée en l'absence de câblage de `src/routes/` à ce jour (agent dédié),
 * même paramètre que celui déjà utilisé par `EcranFicheClient.tsx`/`EcranFicheVehicule.tsx` pour
 * leurs propres ressources ; à ajuster ici si le nom réel diffère une fois le routage posé.
 */
export function EcranFicheOrdreReparation() {
  const { t } = useTranslation(['or', 'commun', 'facturation']);
  const { orId } = useParams<{ orId: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const requete = useOrdreReparation(orId);

  // Lot B — « le devis d'origine, la facture émise ». `listerDocumentsVente` (hooks/facturation/,
  // couche transport déjà existante) sérialise déjà `ordreReparationId` (`FiltresDocumentsVente`,
  // contrat gelé) — appelée ICI en `useQuery` local plutôt que via le hook `useListeDocumentsVente`
  // (pagination infinie, sans option `enabled`) : un OR n'a jamais qu'une poignée de documents
  // liés, une seule page suffit, et `enabled` évite un appel prématuré tant que `or.id` n'est pas
  // connu (l'écran est encore en état de chargement à ce moment-là).
  const requeteDocuments = useQuery({
    queryKey: ['or-documents-vente', requete.data?.id],
    queryFn: () => {
      const filtres: FiltresDocumentsVente = {
        ordreReparationId: requete.data?.id,
        tri: 'dateDocument:desc',
      };
      return listerDocumentsVente(filtres, { limite: 20 });
    },
    enabled: requete.data?.id !== undefined,
  });

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('or:titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('or:titre')}</h1>
        <EtatErreur
          titre={t('or:fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const or = requete.data;

  // Lot B — « chaque ligne pièce vers l'article ». Regroupée par article (une ligne d'OR par
  // pièce en pratique, mais rien ne l'interdit deux fois) plutôt qu'une entrée par ligne : le
  // magasinier/chef d'atelier veut savoir QUELS articles sont sur cet OR, pas recompter les
  // lignes qu'il voit déjà dans le tableau ci-dessus (`ListeLignesOrdreReparation`, hors
  // périmètre). La disponibilité elle-même (stock, réservations) vit sur la fiche article — ce
  // lien y mène plutôt que de dupliquer l'information ici au prix d'une requête par article.
  const piecesParArticle = new Map<string, { designation: string; quantiteMillieme: number }>();
  for (const ligne of or.lignes) {
    if (ligne.articleId === null) continue;
    const existant = piecesParArticle.get(ligne.articleId);
    if (existant) {
      existant.quantiteMillieme += ligne.quantiteMillieme;
    } else {
      piecesParArticle.set(ligne.articleId, {
        designation: ligne.designation,
        quantiteMillieme: ligne.quantiteMillieme,
      });
    }
  }
  const piecesUtilisees = [...piecesParArticle.entries()].map(([articleId, info]) => ({
    articleId,
    ...info,
  }));

  const documentsLies = requeteDocuments.data?.donnees ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('or:titre')}</h1>

      <EnTeteOrdreReparation or={or} />

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('or:actions.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PanneauActionsOr or={or} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="texte-titre-section">{t('or:lignes.titre')}</CardTitle>
          {peutCreerLigneOr(session.data?.utilisateur.role) ? (
            <DialogueAjoutLigneOr orId={or.id} siteId={or.siteId} />
          ) : null}
        </CardHeader>
        <CardContent>
          <ListeLignesOrdreReparation
            orId={or.id}
            lignes={or.lignes}
            lignesTronquees={or.lignesTronquees}
          />
        </CardContent>
      </Card>

      {/* Lot B — pièces utilisées, vers la fiche article (magasinier : « depuis une fiche
       *  article, voir sur quel OR elle a été posée » — ici le sens inverse, tout aussi demandé
       *  par le chef d'atelier). */}
      {piecesUtilisees.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('or:fiche.piecesUtilisees.titre')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {piecesUtilisees.map((piece) => (
                <li key={piece.articleId} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => navigate(chemins.pieces.articleDetail(piece.articleId, site))}
                  >
                    {piece.designation}
                  </button>
                  <span className="texte-libelle tabular-nums text-muted-foreground">
                    {(piece.quantiteMillieme / 1000).toString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Lot B — devis d'origine et facture émise, liés à cet OR (`ordreReparationId`,
       *  `FiltresDocumentsVente`). Route générique `/factures/{id}` (`EcranFicheFacture`, déjà
       *  câblée pour tout `typeDocument`, même lien que `CarteDocumentsVente.tsx` côté ventes). */}
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('or:fiche.documentsVente.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requeteDocuments.isPending ? (
            <EtatChargement lignes={2} />
          ) : requeteDocuments.isError ? (
            <EtatErreur
              titre={t('or:fiche.erreurSection.titre')}
              description={messageErreur(requeteDocuments.error, t)}
              onReessayer={() => void requeteDocuments.refetch()}
            />
          ) : documentsLies.length === 0 ? (
            <EtatVide
              titre={t('or:fiche.documentsVente.titre')}
              description={t('or:fiche.documentsVente.vide')}
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {documentsLies.map((document_) => (
                <li key={document_.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => navigate(`/factures/${document_.id}`)}
                  >
                    {t(
                      `facturation:document.type.${cleTypeDocumentVente(document_.typeDocument, document_.natureFacture ?? null)}`,
                    )}
                    {document_.numero ? ` ${document_.numero}` : ''}
                  </button>
                  <span className="texte-libelle text-muted-foreground">
                    {formaterDate(document_.dateDocument)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lot B — « qui a pointé et combien » (`or.cumulsPointage`, déjà embarqué dans le document
       *  complet, aucune requête supplémentaire). Absent de valeur (pas de pointage) affiché
       *  distinctement d'un total à zéro produit par un pointage réel — même doctrine « une
       *  absence n'est pas une valeur » que le reste du dépôt. */}
      {or.cumulsPointage.parTechnicien.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">{t('or:fiche.pointage.titre')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps sm:grid-cols-3">
              {or.cumulsPointage.parTechnicien.map((cumul) => (
                <div key={cumul.technicienId} className="contents">
                  <dt className="text-muted-foreground">{cumul.nomAffiche}</dt>
                  <dd className="col-span-2 tabular-nums sm:col-span-1">
                    {formaterTempsHeures(cumul.centiemes)}
                  </dd>
                </div>
              ))}
              <div className="contents border-t pt-2">
                <dt className="font-medium text-foreground">{t('or:fiche.pointage.total')}</dt>
                <dd className="col-span-2 font-semibold tabular-nums text-foreground sm:col-span-1">
                  {formaterTempsHeures(or.cumulsPointage.totalCentiemes)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {or.totauxParPayeur && or.totauxParPayeur.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">{t('or:totaux.titre')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps sm:grid-cols-3">
              {or.totauxParPayeur.map((totaux) => (
                // Clé = `(payeur, payeurClientId)` (MD-62), jamais `payeur` seul : deux assurances
                // distinctes sur le même OR partagent `payeur = 'assurance'` mais sont deux groupes
                // — une clé par seul `payeur` les ferait entrer en collision React (dernier gagne,
                // l'autre disparaît silencieusement de l'écran).
                <div key={`${totaux.payeur}:${totaux.payeurClientId ?? ''}`} className="contents">
                  <dt className="text-muted-foreground">
                    {t(`or:lignes.payeurs.${totaux.payeur}`)}
                    {totaux.payeur !== 'client' && totaux.destinataire
                      ? ` — ${totaux.destinataire.nomAffiche}`
                      : ''}
                  </dt>
                  <dd className="col-span-2 font-medium text-foreground sm:col-span-1 texte-montant">
                    {formaterMontant(totaux.montantTtcCentimes)}
                  </dd>
                </div>
              ))}
              {or.totalValideCentimes !== undefined ? (
                <div className="contents border-t pt-2">
                  <dt className="text-muted-foreground">{t('or:totaux.totalValide')}</dt>
                  <dd className="col-span-2 font-semibold text-foreground sm:col-span-1 texte-montant">
                    {formaterMontant(or.totalValideCentimes)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
