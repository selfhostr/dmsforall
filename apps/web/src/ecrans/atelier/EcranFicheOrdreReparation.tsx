import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { FiltresDocumentsVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { formaterDate, formaterMontantAvecDevise } from '@/lib/formats';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';
import { peutCreerLigneOr, peutValiderLigneOr } from './droits';
import { peutPreterCourtoisie } from '@/ecrans/courtoisie/droits';

import { BlocPretCourtoisieOr } from './BlocPretCourtoisieOr';
import { BoutonVehiculeCourtoisieOr } from './BoutonVehiculeCourtoisieOr';
import { EnTeteOrdreReparation } from './EnTeteOrdreReparation';
import { ListeLignesOrdreReparation } from './ListeLignesOrdreReparation';
import { PanneauActionsOr } from './PanneauActionsOr';
import { PanneauTravauxReportesOr } from './PanneauTravauxReportesOr';

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
 * `:orId` — convention assumée en l'absence de câblage de `src/routes/` à ce jour (lot dédié),
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

  const [ligneEnAttenteAjoutee, setLigneEnAttenteAjoutee] = useState(false);
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

  // `titreVisible={false}` FORCÉ (contredit la détection automatique, qui laisserait ce h1
  // visible : « Ordre de réparation » ne recoupe aucun libellé de navigation). Mesuré : ce n'est
  // pas l'onglet qui fait doublon ici mais le CONTENU — `EnTeteOrdreReparation` affiche déjà,
  // juste sous ce même en-tête, le numéro de l'OR en gros caractères (`texte-titre-section`,
  // `or.numero`) accompagné du badge de statut. Rendre ce h1 visible empilerait un second titre
  // générique au-dessus d'une identité déjà affichée — même défaut, à l'intérieur de l'écran
  // plutôt qu'entre l'écran et l'onglet. Comportement inchangé (déjà `sr-only` avant ce chantier),
  // désormais uniforme sur les trois états (chargement/erreur/contenu) via le gabarit commun.
  if (requete.isPending) {
    return (
      <GabaritEcran titre={t('or:titre')} titreVisible={false}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requete.isError) {
    return (
      <GabaritEcran titre={t('or:titre')} titreVisible={false}>
        <EtatErreur
          titre={t('or:fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </GabaritEcran>
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
  const actions = session.data?.actions;
  // Lignes ajoutables et courtoisie utile tant que l'OR n'est ni facturé ni clos.
  const ouvertAuxTravaux = !['termine', 'facture', 'restitue', 'cloture', 'annule'].includes(
    or.statut,
  );

  return (
    <GabaritEcran titre={t('or:titre')} titreVisible={false}>
      <EnTeteOrdreReparation or={or} />

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('or:actions.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <PanneauActionsOr or={or} />
            {ouvertAuxTravaux && peutPreterCourtoisie(actions) ? (
              <div className="flex flex-wrap gap-2">
                <BoutonVehiculeCourtoisieOr orId={or.id} clientId={or.client.id} />
              </div>
            ) : null}
            <BlocPretCourtoisieOr orId={or.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="texte-titre-section">{t('or:lignes.titre')}</CardTitle>
          {peutCreerLigneOr(session.data?.actions) ? (
            <DialogueAjoutLigneOr
              orId={or.id}
              siteId={or.siteId}
              onAjoutee={(ligne) => setLigneEnAttenteAjoutee(ligne.statut === 'proposee')}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {/* Un travail constaté entre « Proposée » : le technicien doit savoir où il en est (ni
           *  refusé, ni validé) et qui doit agir ensuite — le bureau voit la ligne sur cet OR. */}
          {ligneEnAttenteAjoutee ? (
            <p role="status" className="mb-3 flex items-center gap-2 texte-corps text-foreground">
              <Clock aria-hidden className="h-4 w-4 shrink-0 text-statut-attention" />
              {t(
                peutValiderLigneOr(session.data?.actions)
                  ? 'or:lignes.attenteAccord.ajouteeBureau'
                  : 'or:lignes.attenteAccord.ajouteeAtelier',
              )}
            </p>
          ) : null}
          <ListeLignesOrdreReparation
            orId={or.id}
            lignes={or.lignes}
            lignesTronquees={or.lignesTronquees}
            plafondCentimes={or.plafondCentimes ?? 0}
            vehiculeId={or.vehicule.id}
          />
        </CardContent>
      </Card>

      {ouvertAuxTravaux && peutCreerLigneOr(actions) ? (
        <PanneauTravauxReportesOr orId={or.id} vehiculeId={or.vehicule.id} />
      ) : null}

      {/* Regroupement en grille large plutôt qu'empilement (« un écran est plus large que
       *  haut ») : ces quatre cartes sont des blocs d'information COURTS (liste/`dl`), jamais un
       *  contenu qui a besoin de toute la largeur de page comme le tableau de lignes ci-dessus —
       *  les empiler en pleine largeur ne faisait que gaspiller du défilement vertical. Chacune
       *  reste conditionnelle comme avant (contenu inchangé), la grille absorbe simplement
       *  1 à 4 d'entre elles selon ce que ce document précis porte.
       *
       *  DESIGN.md grief n°2 (« vide en bas des cartes ») — `items-start` AJOUTÉ : sans lui, la
       *  grille CSS étire par défaut chaque carte d'une même ligne à la hauteur de sa voisine la
       *  plus haute (ex. « Documents de vente », une ligne, forcée à la hauteur de « Totaux »,
       *  plusieurs lignes) — exactement le vide que `compact` seul ne peut pas corriger, un
       *  problème d'étirement de grille, pas de rembourrage. Même patron déjà en place dans
       *  `TableauBordDirection.tsx`/`TableauBordReceptionnaire.tsx`. `gap-4` -> `gap-groupe` :
       *  jeton de densité (index.css) plutôt qu'une valeur brute, même règle que le reste de
       *  l'écran. */}
      <div className="grid grid-cols-1 gap-groupe lg:grid-cols-2 lg:items-start">
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
                  <li
                    key={piece.articleId}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <button
                      type="button"
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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
                description={
                  // Issue #105 (rapport terrain) : « OR restitué + clôturé, aucune facture liée,
                  // bug ? » — non, `cloturer()` ne vérifie jamais l'existence d'un document
                  // (RF-83, migration 0010_facturation.sql §15 : facturation et restitution
                  // INDÉPENDANTES). Mais l'écran rendait jusqu'ici le MÊME message générique
                  // qu'un OR encore ouvert à la facturation — exactement la règle maison violée
                  // (« absence de donnée ≠ valeur : "inconnu", "aucun", "interdit" ne partagent
                  // jamais le même rendu »). Trois cas distincts, aucun motif métier inventé
                  // au-delà de ce que le contrat porte déjà (`or.statut`/`or.motifAnnulation`).
                  or.statut === 'cloture'
                    ? t('or:fiche.documentsVente.clotureSansFacture')
                    : or.statut === 'annule'
                      ? t('or:fiche.documentsVente.annuleSansFacture', {
                          motif: or.motifAnnulation,
                        })
                      : t('or:fiche.documentsVente.pasEncoreFacture')
                }
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {documentsLies.map((document_) => (
                  <li key={document_.id} className="flex items-center justify-between gap-3 py-2">
                    <button
                      type="button"
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps">
                {or.cumulsPointage.parTechnicien.map((cumul) => (
                  <div key={cumul.technicienId} className="contents">
                    <dt className="text-muted-foreground">{cumul.nomAffiche}</dt>
                    <dd className="tabular-nums">{formaterTempsHeures(cumul.centiemes)}</dd>
                  </div>
                ))}
                <div className="contents border-t pt-2">
                  <dt className="font-medium text-foreground">{t('or:fiche.pointage.total')}</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
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
            <CardContent className="flex flex-col gap-2">
              {/* Grille à 2 colonnes FIXES, jamais `sm:grid-cols-3` : chaque paire (`dt` + `dd`)
               *  n'utilise que 2 cellules — sur une grille à 3 colonnes, le nombre total de
               *  cellules n'est multiple de 3 que par coïncidence (payeur unique = 4 cellules =
               *  décalage garanti). Le total n'a plus besoin de `col-span`/`sm:col-span` puisque
               *  chaque paire occupe naturellement sa propre ligne. */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps">
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
                    <dd className="font-medium text-foreground texte-montant">
                      {t('or:lignes.montants.ttc', {
                        montant: formaterMontantAvecDevise(totaux.montantTtcCentimes, 'CHF'),
                      })}
                    </dd>
                  </div>
                ))}
                {or.totalValideCentimes !== undefined ? (
                  // `border-t`/`pt-2` posés sur `dt`/`dd` eux-mêmes, jamais sur ce conteneur
                  // `display: contents` : un élément à `display: contents` ne génère aucune boîte
                  // propre, donc une bordure/un padding posé dessus ne s'affiche jamais.
                  <div className="contents">
                    <dt className="border-t pt-2 text-muted-foreground">
                      {t('or:totaux.totalValide')}
                    </dt>
                    <dd className="border-t pt-2 font-semibold text-foreground texte-montant">
                      {t('or:lignes.montants.ttc', {
                        montant: formaterMontantAvecDevise(or.totalValideCentimes, 'CHF'),
                      })}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {/* CORRECTIF issue #72 (rapport de test terrain) : « il y a deux totaux différents,
               *  Client 958.31 et Total validé 894.53. Lequel je dis au client ? » — les deux
               *  chiffres sont réels mais répondent à des questions différentes (`totaux-payeur.ts`
               *  regroupe TOUTES les lignes non annulées/refusées par payeur ; `totalValideCentimes`
               *  suit le plafond, § RM-54, sur les lignes VALIDÉES de TOUS les payeurs confondus,
               *  jamais un montant facturable). Le renommage du libellé ci-dessus ne suffit pas à
               *  lui seul à lever l'ambiguïté une fois les deux chiffres sous les yeux — cette phrase
               *  la tranche explicitement. */}
              {or.totalValideCentimes !== undefined ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('or:totaux.aideDistinction')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </GabaritEcran>
  );
}
