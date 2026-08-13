import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { schemaEmissionDocumentVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { obtenirEnv } from '@/config/env';
import { useDocumentVente } from '@/hooks/facturation/useDocumentVente';
import { useEmettreDocumentVente } from '@/hooks/facturation/useEmettreDocumentVente';
import { useModifierDocumentVente } from '@/hooks/facturation/useModifierDocumentVente';
import { useSession } from '@/hooks/useSession';
import {
  formaterDate,
  formaterMontant,
  formaterMontantAvecDevise,
  formaterPourmille,
} from '@/lib/formats';

import { BadgeEtatDocument } from './BadgeEtatDocument';
import { BadgeStatutReglement } from './BadgeStatutReglement';
import { BadgeTypeDocument } from './BadgeTypeDocument';
import { CarteBulletinVersement } from './CarteBulletinVersement';
import { ChampVerrouille } from './ChampVerrouille';
import { DialogueCorrectionFacture } from './DialogueCorrectionFacture';
import { peutEmettreAvoir, peutEmettreFacture, peutEncaisser } from './droits';
import { IndicateurRetard } from './IndicateurRetard';
import { RecapitulatifTVA } from './RecapitulatifTVA';
import { SheetEncaissement } from './SheetEncaissement';

/**
 * Écran 2 — Facture : édition, émission, verrouillage (`design-etape-2-facturation.md` §4). Route
 * attendue : `/factures/:id` — un seul écran, deux visages selon `statut` (brouillon éditable /
 * émis verrouillé), jamais deux composants séparés (§4, en-tête). Sert aussi bien une facture
 * qu'un avoir (même ressource `documents-vente`), `BadgeTypeDocument` distingue les deux à l'écran.
 *
 * ÉCARTS SIGNALÉS (voir aussi les commentaires en tête de `documents-vente.api.ts` et
 * `DialogueCorrectionFacture.tsx`) :
 *  - **Destinataire non éditable** : `EntreeModificationDocumentVente` (`schemaModificationDocumentVente`)
 *    ne porte NI `adresseFacturation` NI aucun champ destinataire — seuls `clientId`, `vehiculeId`,
 *    `dateDocument` et la remise globale sont modifiables par `PATCH`. La Card « Destinataire » est
 *    donc en LECTURE SEULE même en brouillon, avec un lien vers la fiche client plutôt qu'un
 *    formulaire qui n'aurait rien à soumettre (§4.2 du design suppose un champ éditable qui n'existe
 *    pas dans le contrat gelé).
 *  - **Pas de libellé de remise globale persistable** : `remiseGlobaleSaisieCentimes`/
 *    `remiseGlobalePourmille` existent, mais aucun champ `libelle` n'est prévu par le contrat
 *    (`RF-42` du design promet « Remise fidélité » affiché sur le document — rien ne le stocke).
 *    Le montant/pourcentage reste éditable, le libellé personnalisé est omis.
 *  - **Menu ⋯ réduit** : « Corriger cette facture », « Créer un avoir » et désormais « Imprimer /
 *    télécharger le PDF » (`GET /documents-vente/{id}/pdf`, `impression-facture.controller.ts`)
 *    sont raccordés à un endpoint réel. « Envoyer par e-mail », « Dupliquer » et « Voir le
 *    journal » (§4.6) n'ont toujours pas d'endpoint documenté dans `@dfa/shared` à ce jour (aucun
 *    `POST .../envoyer`, aucun `GET .../journal` sur `documents-vente`) — plutôt que des boutons
 *    qui échoueraient silencieusement, ils restent omis.
 *  - **Éligibilité du PDF = `document_.qr !== null`**, jamais une lecture directe du rôle courant :
 *    même mécanisme que `totalTtcCentimes`/`RecapitulatifTVA` déjà en place sur cet écran — le
 *    serveur masque déjà `qr` à `null` pour un devis, un bon de commande, un avoir, un brouillon
 *    ET pour un rôle sans droit aux montants (`RF-116`, `mapperDocument` : `qr: voitMontants ? ... :
 *    null`), donc ce seul test couvre exactement `facturation.document.imprimer`
 *    (`impression-facture.controller.ts`, `estEligibleImpression`) sans dupliquer la matrice de
 *    droits côté front. Un lien `<a>` simple (pas de `fetch`+blob) vers `GET .../pdf` : le
 *    navigateur gère nativement le cache via l'`ETag` (SHA-256 du PDF) sur les clics suivants.
 *  - **`RefusBloquant` pour bloc créancier incomplet (§4.5)** : aucun champ de `ReponseDocumentVente`
 *    ne signale ce blocage AVANT tentative d'émission (contrairement à ce que suppose le design,
 *    « détecté en amont, dès l'ouverture du brouillon ») — il n'apparaît ici qu'EN RÉACTION à un
 *    échec réel de `POST .../emettre`, dans le dialogue de confirmation.
 */
export function EcranFicheFacture() {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const requete = useDocumentVente(id);
  const modification = useModifierDocumentVente();
  const emission = useEmettreDocumentVente();

  const [dialogueEmissionOuvert, setDialogueEmissionOuvert] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [encaissementOuvert, setEncaissementOuvert] = useState(false);
  const [correctionOuverte, setCorrectionOuverte] = useState(false);
  const [remiseCentimes, setRemiseCentimes] = useState<number | null>(null);

  useEffect(() => {
    if (dialogueEmissionOuvert) {
      setIdempotencyKey(genererCleIdempotence());
    }
  }, [dialogueEmissionOuvert]);

  // Ne resynchronise `remiseCentimes` QUE lors du chargement initial ou d'un changement de
  // document (`document_.id` en dépendance, jamais `requete.data` en entier) — pas à chaque
  // nouvelle référence d'objet renvoyée par un refetch (fenêtre refocus, `refetchOnWindowFocus:
  // true` sur ce QueryClient). Le champ est éditable et n'est persisté qu'au clic « Enregistrer » ;
  // un refetch qui écraserait la saisie non enregistrée dès que l'utilisateur revient sur l'onglet
  // ferait perdre sa saisie sans qu'il s'en rende compte. Navigation vers une AUTRE facture
  // (`id` change) doit en revanche bien recharger le champ, d'où la dépendance sur l'identifiant.
  useEffect(() => {
    if (requete.data) {
      setRemiseCentimes(requete.data.remiseGlobaleSaisieCentimes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requete.data?.id]);

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:titre')}</h1>
        <EtatErreur
          titre={t('facturation:fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const document_ = requete.data;
  const estBrouillon = document_.statut === 'brouillon';
  const estAnnuleeParAvoir = document_.statut === 'annule_par_avoir';
  const etatAffiche = estAnnuleeParAvoir ? 'annule_par_avoir' : estBrouillon ? 'brouillon' : 'emis';
  const destinataireNom = document_.figees.clientDesignation;
  const adresse = document_.figees.adresseFacturation;
  const adresseComplete = Boolean(adresse && adresse.rue && adresse.npa && adresse.localite);
  // Encaisser/corriger/créer un avoir : uniquement une FACTURE déjà émise, pas encore annulée par
  // un avoir (§4.6 — une facture annulée par avoir ne se corrige ni ne se recrédite une deuxième
  // fois).
  const peutGererFacture =
    !estBrouillon && !estAnnuleeParAvoir && document_.typeDocument === 'facture';
  // Défaut corrigé (issue #80/#94, testeur novice — « je n'ai pas osé cliquer Encaisser, j'allais
  // enregistrer une avance sur le compte d'un client qui a déjà payé ») : `peutGererFacture` ne
  // regarde que l'ÉTAT DU DOCUMENT (émis, pas annulé), jamais s'il reste quelque chose À ENCAISSER
  // — une facture `emis` intégralement `regle` (`soldeCentimes === 0`) remplissait la condition et
  // affichait quand même le bouton. `soldeCentimes` (jamais négatif, `RF-67`) est le seul prédicat
  // correct : « rien à encaisser » se lit sur l'ARGENT dû, pas sur le libellé `statutReglement`
  // (`irrecouvrable` reste, par exemple, un solde non nul qu'on peut légitimement recevoir).
  const resteDuCentimes = document_.soldeCentimes;
  const resteAEncaisser = resteDuCentimes !== undefined && resteDuCentimes > 0;
  // Trois droits DISTINCTS, superposés à `estBrouillon`/`peutGererFacture` (état du document) —
  // défaut corrigé : ces deux booléens ne dépendaient auparavant que de l'état, jamais du rôle, et
  // affichaient les trois gestes financiers à des rôles sans le droit correspondant côté serveur
  // (`apps/api/src/auth/matrice-droits.ts`, voir `./droits.ts` pour le miroir exact). Doctrine du
  // dépôt : un rôle sans droit ne voit pas un bouton grisé, il ne voit pas de bouton.
  const proposeEmettre = estBrouillon && peutEmettreFacture(role);
  const proposeEncaisser = peutGererFacture && resteAEncaisser && peutEncaisser(role);
  const proposeCreerAvoir = peutGererFacture && peutEmettreAvoir(role);
  const proposeCorriger = peutGererFacture;
  // Imprimer : condition DÉCOUPLÉE de `peutGererFacture` — voir le commentaire de tête de fichier.
  // `document_.qr !== null` implique déjà `typeDocument === 'facture'` et une émission passée
  // (`mapperDocument`, serveur), donc ce document reste imprimable même `estAnnuleeParAvoir`
  // (`impression-facture.controller.ts` ne teste que `typeDocument`/`qr`, jamais `statut`).
  const peutImprimer = document_.qr !== null;
  const urlPdf = `${obtenirEnv().VITE_API_URL}/documents-vente/${document_.id}/pdf`;

  function ouvrirCorrection() {
    setCorrectionOuverte(true);
  }

  function soumettreEmission() {
    if (!idempotencyKey) return;
    const resultat = schemaEmissionDocumentVente.safeParse({});
    if (!resultat.success) return;
    emission.mutate(
      { id: document_.id, entree: resultat.data, idempotencyKey },
      { onSuccess: () => setDialogueEmissionOuvert(false) },
    );
  }

  function enregistrerRemise() {
    modification.mutate({
      id: document_.id,
      entree: { remiseGlobaleSaisieCentimes: remiseCentimes, remiseGlobalePourmille: null },
      etag: `W/"${document_.version}"`,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('facturation:titre')}</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <BadgeEtatDocument etat={etatAffiche} />
          {/* Défaut corrigé (issue #80, testeur novice) : cette fiche n'affichait QUE l'état du
              DOCUMENT (« Émise »), jamais l'état du RÈGLEMENT — la liste (`EcranListeFactures.tsx`)
              affichait l'inverse (règlement seul, jamais « Émise »). Même paire de badges, mêmes
              mots, aux deux endroits — voir le commentaire jumeau côté liste. Restreint à `emis` :
              un brouillon (`statutReglement` par défaut, rien n'est dû) ou une facture déjà
              `annule_par_avoir` (`statutReglement` figé d'AVANT l'annulation, `RF-32`) ne doivent
              jamais porter ce badge, même doctrine que la liste. */}
          {etatAffiche === 'emis' && document_.statutReglement ? (
            <BadgeStatutReglement statut={document_.statutReglement} />
          ) : null}
          <span className="texte-titre-section font-semibold text-foreground">
            {document_.numero ?? t('facturation:document.etat.brouillon')} — {destinataireNom}
          </span>
          <BadgeTypeDocument type={document_.typeDocument} nature={document_.natureFacture} />
          {document_.ordreReparationId ? (
            <button
              type="button"
              className="texte-libelle text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => navigate(`/ordres-reparation/${document_.ordreReparationId}`)}
            >
              {t('facturation:fiche.issueDeOr')}
            </button>
          ) : null}
          {/* Défaut corrigé (issue #60, testeur novice) : `emisLe` est l'horodatage SERVEUR de
              l'émission, jamais la date légale/métier du document (`document.ts` : « les deux
              champs ne sont PAS interchangeables et ne doivent pas partager le même libellé côté
              écran »). Cette ligne affichait `emisLe` sous le libellé « émise le », en désaccord
              avec la liste (`EcranListeFactures.tsx`) et la feuille d'encaissement
              (`SheetEncaissement.tsx`), qui affichent TOUTES DEUX `dateDocument` sous ce même
              libellé — trois dates différentes pour un même document selon l'écran. `dateDocument`
              est non nul par construction (`document.ts`) : plus de garde de nullité nécessaire,
              affiché pour tout document comme le fait déjà la liste. */}
          <span className="texte-libelle text-muted-foreground">
            {t('facturation:fiche.emiseLe', { date: formaterDate(document_.dateDocument) })}
          </span>
          {/* `dateEcheance` n'a de sens que sur une facture (`document.ts` : toujours `null` pour
              un devis/bon de commande/avoir — « aucune échéance de paiement ne les concerne »).
              Restreindre l'affichage au `typeDocument` évite un "Échéance inconnue" trompeur sur
              un document qui n'est structurellement jamais échu. La disparition pour un rôle sans
              droit financier vient naturellement de `dateEcheance === undefined`
              (`IndicateurRetard` rend alors `null`), même mécanisme que `totalTtcCentimes`. */}
          {document_.typeDocument === 'facture' ? (
            <IndicateurRetard
              dateEcheance={document_.dateEcheance}
              enRetard={document_.enRetard}
              joursRetard={document_.joursRetard}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {proposeEmettre ? (
            <Button type="button" onClick={() => setDialogueEmissionOuvert(true)}>
              {t('facturation:fiche.actions.emettre')}
            </Button>
          ) : null}
          {proposeEncaisser ? (
            <Button type="button" onClick={() => setEncaissementOuvert(true)}>
              {t('facturation:fiche.actions.encaisser')}
            </Button>
          ) : null}
          {peutImprimer || proposeCorriger || proposeCreerAvoir ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('facturation:fiche.actions.autresActions')}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {peutImprimer ? (
                  <DropdownMenuItem asChild>
                    <a href={urlPdf} target="_blank" rel="noopener noreferrer">
                      {t('facturation:fiche.actions.menu.imprimer')}
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {proposeCorriger ? (
                  <DropdownMenuItem onSelect={ouvrirCorrection}>
                    {t('facturation:fiche.actions.menu.corriger')}
                  </DropdownMenuItem>
                ) : null}
                {proposeCreerAvoir ? (
                  <DropdownMenuItem onSelect={() => navigate(`/factures/${document_.id}/avoir`)}>
                    {t('facturation:fiche.actions.menu.creerAvoir')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {estAnnuleeParAvoir && document_.annuleParAvoirId ? (
        <div className="rounded-md border bg-muted px-4 py-3 texte-corps text-foreground">
          {t('facturation:fiche.annuleeParAvoir.message')}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('facturation:fiche.destinataire.titre')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {/* Le nom est un vrai bouton de navigation vers la fiche client (défaut corrigé :
                  aucun chemin ne menait au client depuis une facture normale, seul un bouton
                  « Compléter la fiche » apparaissait, et seulement si l'adresse était incomplète).
                  Rendu HORS de `ChampVerrouille` ci-dessous à dessein : `ChampVerrouille` enveloppe
                  son `enfant` dans un `<div role="button">` (voir son commentaire de tête) — y
                  imbriquer un `<button>` natif superposerait deux cibles interactives sur la même
                  zone (le clic sur le nom aurait aussi ouvert le popover « verrouillé », le focus
                  clavier aurait créé deux arrêts de tabulation pour un seul élément visuel). Même
                  patron que le lien vers l'OR ci-dessus (~ligne 220) : un `<button type="button">`
                  natif, jamais un `<div onClick>`. */}
              <button
                type="button"
                className="w-fit rounded-sm text-left texte-corps font-medium text-foreground underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => navigate(`/clients/${document_.clientId}`)}
              >
                {destinataireNom}
              </button>
              {(() => {
                if (!adresse) return null;
                const blocAdresse = (
                  <p className="texte-corps text-muted-foreground">
                    {adresse.rue} {adresse.numero ?? ''}
                    <br />
                    {adresse.npa} {adresse.localite}
                  </p>
                );
                // Verrouillé dès que le document n'est plus un brouillon (§4.6) — un avoir émis
                // n'a de toute façon aucune correction possible (`onAction` reste néanmoins
                // câblé pour l'uniformité, la facture d'origine seule est corrigible en pratique).
                return estBrouillon ? (
                  blocAdresse
                ) : (
                  <ChampVerrouille
                    enfant={blocAdresse}
                    message={t('facturation:verrouille.message')}
                    libelleAction={t('facturation:verrouille.corriger')}
                    onAction={ouvrirCorrection}
                  />
                );
              })()}
              {!adresseComplete ? (
                <div className="flex flex-col gap-1 rounded-md border bg-muted px-3 py-2 texte-libelle text-foreground">
                  <span>
                    {estBrouillon
                      ? t('facturation:champs.adresseIncompleteEmission')
                      : t('facturation:champs.adresseIncompleteEmis')}
                  </span>
                  <button
                    type="button"
                    className="text-left font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => navigate(`/clients/${document_.clientId}`)}
                  >
                    {t('facturation:champs.completerFiche')}
                  </button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('facturation:fiche.lignes.titre')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!estBrouillon ? (
                <button
                  type="button"
                  className="w-fit texte-libelle text-muted-foreground underline-offset-2 hover:underline"
                  onClick={ouvrirCorrection}
                >
                  {t('facturation:verrouille.message')} {t('facturation:verrouille.corriger')}
                </button>
              ) : null}
              {document_.lignes.length === 0 ? (
                <p className="texte-corps text-muted-foreground">
                  {t('facturation:fiche.lignes.vide')}
                </p>
              ) : (
                <Table densite="dense">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('facturation:fiche.lignes.colonnes.designation')}</TableHead>
                      <TableHead className="text-right">
                        {t('facturation:fiche.lignes.colonnes.quantite')}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('facturation:fiche.lignes.colonnes.prixUnitaire')}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('facturation:fiche.lignes.colonnes.montant')}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('facturation:fiche.lignes.colonnes.tva')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {document_.lignes.map((ligne) => {
                      const contenu = (
                        <TableRow key={ligne.id} className={cnLigne(ligne.ligneOrId !== null)}>
                          <TableCell>
                            {ligne.designation}
                            {ligne.ligneOrId !== null ? (
                              <span className="ml-2 texte-libelle text-muted-foreground">
                                {t('facturation:ligneDepuisOrGenerique')}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(ligne.quantiteMillieme / 1000).toString()}
                          </TableCell>
                          {/* Pas de préfixe devise ICI : toutes les lignes d'UN document partagent
                              nécessairement la même devise (`document_.devise`), déjà annoncée au
                              pied du document (Total TTC) et dans le dialogue d'émission — la
                              répéter sur chaque ligne serait du bruit, pas de l'information (à la
                              différence d'`EcranListeFactures`, où chaque LIGNE est un document
                              distinct qui peut porter sa propre devise). */}
                          <TableCell className="text-right tabular-nums">
                            {ligne.prixUnitaireTtcCentimes !== null &&
                            ligne.prixUnitaireTtcCentimes !== undefined
                              ? formaterMontant(ligne.prixUnitaireTtcCentimes)
                              : ''}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {ligne.montants
                              ? formaterMontant(ligne.montants.montantTtcCentimes)
                              : ''}
                          </TableCell>
                          <TableCell className="text-right texte-libelle text-muted-foreground">
                            {formaterPourmille(ligne.tauxTvaPourmille)}
                          </TableCell>
                        </TableRow>
                      );
                      return contenu;
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {estBrouillon ? (
            <Card>
              <CardHeader>
                <CardTitle className="texte-titre-section">
                  {t('facturation:champs.remiseGlobale.titre')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-end gap-3">
                <ChampMontant
                  valeurCentimes={remiseCentimes}
                  onChangeCentimes={setRemiseCentimes}
                  label={t('facturation:champs.remiseGlobale.montant')}
                  devise={document_.devise}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={modification.isPending}
                  onClick={enregistrerRemise}
                >
                  {t('facturation:actions.enregistrer')}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex justify-end">
            <div className="rounded-md border p-4 text-right">
              <p className="texte-libelle text-muted-foreground">
                {t('facturation:fiche.totalTtc')}
              </p>
              <p className="texte-chiffre-geant tabular-nums font-semibold text-foreground">
                {document_.totalTtcCentimes !== undefined
                  ? formaterMontantAvecDevise(document_.totalTtcCentimes, document_.devise)
                  : t('facturation:fiche.montantIndisponible')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <RecapitulatifTVA
            ventilationTva={document_.ventilationTva}
            totalTtcCentimes={document_.totalTtcCentimes}
            devise={document_.devise}
          />

          <CarteBulletinVersement qr={document_.qr} />

          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('facturation:fiche.documentsLies.titre')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 texte-corps">
              {document_.ordreReparationId ? (
                <button
                  type="button"
                  className="text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/ordres-reparation/${document_.ordreReparationId}`)}
                >
                  {t('facturation:fiche.documentsLies.or')}
                </button>
              ) : null}
              {document_.factureAnnuleeId ? (
                <button
                  type="button"
                  className="text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/factures/${document_.factureAnnuleeId}`)}
                >
                  {t('facturation:fiche.documentsLies.facture')}
                </button>
              ) : null}
              {document_.annuleParAvoirId ? (
                <button
                  type="button"
                  className="text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/factures/${document_.annuleParAvoirId}`)}
                >
                  {t('facturation:fiche.documentsLies.avoir')}
                </button>
              ) : null}
              {!document_.ordreReparationId &&
              !document_.factureAnnuleeId &&
              !document_.annuleParAvoirId ? (
                <p className="text-muted-foreground">{t('facturation:fiche.documentsLies.vide')}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={dialogueEmissionOuvert} onOpenChange={setDialogueEmissionOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('facturation:fiche.dialogueEmission.titre')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="texte-corps">
              {t('facturation:fiche.dialogueEmission.resume', {
                destinataire: destinataireNom,
                montant:
                  document_.totalTtcCentimes !== undefined
                    ? formaterMontantAvecDevise(document_.totalTtcCentimes, document_.devise)
                    : '',
              })}
            </p>
            <p className="texte-corps text-muted-foreground">
              {t('facturation:fiche.dialogueEmission.avertissement')}
            </p>
            {!adresseComplete ? (
              <p className="texte-libelle text-statut-attention">
                {t('facturation:champs.adresseIncompleteEmission')}
              </p>
            ) : null}
            {emission.isError ? (
              <p className="texte-libelle text-destructive">{messageErreur(emission.error, t)}</p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t('commun:actions.annuler')}</Button>
            </DialogClose>
            <Button disabled={emission.isPending} onClick={soumettreEmission}>
              {emission.isPending
                ? t('facturation:fiche.dialogueEmission.enCours')
                : t('facturation:fiche.dialogueEmission.confirmer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SheetEncaissement
        ouvert={encaissementOuvert}
        onOuvertChange={setEncaissementOuvert}
        siteId={document_.siteId}
        clientId={document_.clientId}
        destinataireNom={destinataireNom}
        factureIdPreselectionnee={document_.id}
      />

      <DialogueCorrectionFacture
        facture={document_}
        ouvert={correctionOuverte}
        onOuvertChange={setCorrectionOuverte}
        onSucces={(_avoirNumero, _nouvelleNumero, idNouvelleFacture) =>
          navigate(`/factures/${idNouvelleFacture}`)
        }
      />
    </div>
  );
}

function cnLigne(depuisOr: boolean): string | undefined {
  return depuisOr ? 'bg-muted/30' : undefined;
}
