import { Download, Pencil, Plus } from 'lucide-react';
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
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { BoutonImprimerDocument } from '@/composants/motifs/BoutonImprimerDocument';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { obtenirEnv } from '@/config/env';
import { useAccepterDevis } from '@/hooks/facturation/useAccepterDevis';
import { useDocumentVente } from '@/hooks/facturation/useDocumentVente';
import { useTelechargerPdfDocument } from '@/hooks/facturation/useTelechargerPdfDocument';
import { useEmettreDocumentVente } from '@/hooks/facturation/useEmettreDocumentVente';
import { useSupprimerLigneDocument } from '@/hooks/facturation/useLignesDocumentVente';
import { useModifierDocumentVente } from '@/hooks/facturation/useModifierDocumentVente';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { peutCreerOrdreReparation } from '@/ecrans/atelier/droits';
import {
  formaterDate,
  formaterMontant,
  formaterMontantAvecDevise,
  formaterPourmille,
} from '@/lib/formats';

import { BadgeEtatDocument } from './BadgeEtatDocument';
import { BadgeStatutDevis } from './BadgeStatutDevis';
import { BadgeStatutReglement } from './BadgeStatutReglement';
import { BadgeTypeDocument } from './BadgeTypeDocument';
import { CarteBulletinVersement } from './CarteBulletinVersement';
import { ChampVerrouille } from './ChampVerrouille';
import { DialogueCorrectionFacture } from './DialogueCorrectionFacture';
import { DialogueRemplacerFacture } from './DialogueRemplacerFacture';
import { DialogueCreerOrDepuisDevis } from './DialogueCreerOrDepuisDevis';
import { DialogueLigneDocumentVente } from './DialogueLigneDocumentVente';
import {
  peutAccepterDevis,
  peutCorrigerFacture,
  peutEmettreDevis,
  peutEmettreAvoir,
  peutEmettreFacture,
  peutEncaisser,
  peutVoirMontantsFacturation,
} from './droits';
import { IndicateurRetard } from './IndicateurRetard';
import { messagesErreurMutation } from './messages-erreur-mutation';
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
  const actions = session?.actions;

  const requete = useDocumentVente(id);
  const modification = useModifierDocumentVente();
  const estDevis = requete.data?.typeDocument === 'devis';
  const emission = useEmettreDocumentVente(
    estDevis ? { succes: 'facturation:toasts.devisEnvoye' } : {},
  );
  const accord = useAccepterDevis();
  const suppressionLigne = useSupprimerLigneDocument();
  const pdfDevis = useTelechargerPdfDocument();

  const [dialogueEmissionOuvert, setDialogueEmissionOuvert] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [encaissementOuvert, setEncaissementOuvert] = useState(false);
  const [correctionOuverte, setCorrectionOuverte] = useState(false);
  const [remplacementOuvert, setRemplacementOuvert] = useState(false);
  const [creationOrOuverte, setCreationOrOuverte] = useState(false);
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

  // Titre générique tant que le document n'est pas chargé (numéro/type pas encore connus) — passe
  // quand même par `GabaritEcran` (chantier « titres doublés & espacements », 17.08.2026) pour que
  // la structure d'en-tête ne saute pas entre chargement/erreur/contenu. « Facture » (mot seul) est
  // contenu dans le libellé de l'onglet « Factures » (`navigation:onglets.facturationFactures`) —
  // masqué en `sr-only` par la détection automatique, comme le h1 `sr-only` déjà posé ici avant ce
  // chantier ; aucune régression visuelle, aucune `titreVisible` posée.
  if (requete.isPending) {
    return (
      <GabaritEcran titre={t('facturation:document.type.facture')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requete.isError) {
    return (
      <GabaritEcran titre={t('facturation:document.type.facture')}>
        <EtatErreur
          titre={t('facturation:fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </GabaritEcran>
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
  // Quatre droits DISTINCTS, superposés à `estBrouillon`/`peutGererFacture` (état du document) —
  // défaut corrigé : ces deux booléens ne dépendaient auparavant que de l'état, jamais du rôle, et
  // affichaient les gestes financiers à des rôles sans le droit correspondant côté serveur
  // (`apps/api/src/auth/matrice-droits.ts`, voir `./droits.ts` pour le miroir exact). Doctrine du
  // dépôt : un rôle sans droit ne voit pas un bouton grisé, il ne voit pas de bouton.
  //
  // `proposeCorriger` (DÉFAUT CORRIGÉ, relevé au test manuel du 14.08.2026) : gouvernait
  // auparavant SEUL le menu « Corriger cette facture » (`peutGererFacture`, sans aucun contrôle de
  // rôle) — le lien « Corriger par un avoir → » sous les lignes et celui de la carte Destinataire
  // (`ChampVerrouille.onAction`) restaient en plus câblés directement sur `ouvrirCorrection()`,
  // hors de toute condition, donc actifs pour N'IMPORTE QUEL rôle y compris `admin`. Les TROIS
  // points d'entrée (menu, lien sous les lignes, action du champ verrouillé) sont désormais
  // gouvernés par CE SEUL booléen — voir `peutCorrigerFacture` (`./droits.ts`) pour le détail du
  // rôle et l'état RÉEL du serveur aujourd'hui (l'endpoint `POST .../corriger` n'existe pas encore).
  const documentEstDevis = document_.typeDocument === 'devis';
  const messageVerrouille = t(
    documentEstDevis ? 'facturation:verrouille.messageDevis' : 'facturation:verrouille.message',
  );
  const proposeEmettre =
    estBrouillon && (documentEstDevis ? peutEmettreDevis(actions) : peutEmettreFacture(actions));
  // Devis AUTONOME : l'accord du client et l'ouverture de l'OR se font ici, pas seulement depuis un
  // travail d'OR. Un devis `emis` attend l'accord ; `emis` ou `accepte`, sans véhicule inconnu ni OR
  // déjà ouvert, il peut devenir un OR (le serveur reprend client, véhicule et lignes).
  const proposeAccord =
    documentEstDevis && document_.statut === 'emis' && peutAccepterDevis(actions);
  const proposeCreerOr =
    documentEstDevis &&
    (document_.statut === 'emis' || document_.statut === 'accepte') &&
    document_.ordreReparationId === null &&
    document_.vehiculeId !== null &&
    peutCreerOrdreReparation(actions);
  const proposeEncaisser = peutGererFacture && resteAEncaisser && peutEncaisser(actions);
  const proposeCreerAvoir = peutGererFacture && peutEmettreAvoir(actions);
  const proposeCorriger = peutGererFacture && peutCorrigerFacture(actions);
  // Imprimer : condition DÉCOUPLÉE de `peutGererFacture` — voir le commentaire de tête de fichier.
  // `document_.qr !== null` implique déjà `typeDocument === 'facture'` et une émission passée
  // (`mapperDocument`, serveur), donc ce document reste imprimable même `estAnnuleeParAvoir`
  // (`impression-facture.controller.ts` ne teste que `typeDocument`/`qr`, jamais `statut`).
  const peutImprimer = document_.qr !== null;
  // PDF d'un DEVIS : pas de lien direct (`qr` est toujours `null` hors facture émise) mais un
  // téléchargement qui affiche l'échec — `DOCUMENT_PDF_INDISPONIBLE` tant que l'API ne le produit
  // pas, plutôt qu'un onglet vide. Réservé aux rôles qui voient les montants.
  const peutPdfDevis = document_.typeDocument === 'devis' && peutVoirMontantsFacturation(actions);
  const urlPdf = `${obtenirEnv().VITE_API_URL}/documents-vente/${document_.id}/pdf`;
  // Titre de FICHE (chantier « titres doublés & espacements », 17.08.2026) — « Facture 2026-00002 »
  // / « Avoir 2026-AV-00001 » : CONTRE-EXEMPLE cité par le contrat du chantier, il ne fait PAS
  // doublon avec l'onglet « Factures » (aucune inclusion : « facture » ≠ « factures » une fois le
  // numéro accolé) et doit rester VISIBLE, à la différence du titre générique de chargement
  // ci-dessus. Aucun `titreVisible` posé : la détection automatique du gabarit suffit ici aussi.
  const titreDocument = document_.numero
    ? t('facturation:fiche.titre', {
        type: t(`facturation:document.type.${document_.typeDocument}`),
        numero: document_.numero,
      })
    : document_.typeDocument === 'avoir'
      ? t('facturation:fiche.titreBrouillonAvoir')
      : document_.typeDocument === 'devis'
        ? t('facturation:fiche.titreBrouillonDevis')
        : document_.typeDocument === 'bon_commande'
          ? t('facturation:fiche.titreBrouillonBonCommande')
          : t('facturation:fiche.titreBrouillonFacture');

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

  // Actions de l'écran (chantier « titres doublés & espacements », 17.08.2026) — définies avant le
  // retour pour être passées à `GabaritEcran` plutôt qu'imbriquées dans un second bloc `justify-
  // between` local, désormais porté par le gabarit.
  //
  // CHANTIER D'UNIFICATION INTER-ÉCRANS (25.08.2026) — deux défauts corrigés ici en même temps :
  //  1. Le menu « … » était un clone à la main du composant partagé `ActionPrimaire`
  //     (`composants/layout/ActionPrimaire.tsx`, déjà utilisé par `EnTeteOrdreReparation`/
  //     `EnTeteDossierVente`/`EcranFicheVehiculeStock`) — même déclencheur `MoreHorizontal`, même
  //     rôle, réimplémenté ici plutôt que réutilisé. `proposeEmettre`/`proposeEncaisser` sont
  //     mutuellement exclusifs (le premier exige `estBrouillon`, le second exige `peutGererFacture
  //     = !estBrouillon && ...`) : AU PLUS UNE action primaire à la fois, exactement le contrat
  //     d'`ActionPrimaire` (« UN SEUL élément interactif », voir son en-tête).
  //  2. « Imprimer » vivait dans ce même menu « … », sous une troisième forme locale (lien `<a>`
  //     enveloppé dans un `DropdownMenuItem asChild`) — troisième variante du même mécanisme déjà
  //     dupliqué en atelier (`BoutonImprimerOr`, bouton autonome) et en pièces
  //     (`PanneauRapprochementFacture`, bouton autonome de taille différente). Remplacé par
  //     `BoutonImprimerDocument` (`composants/motifs/`, extrait de `BoutonImprimerOr` — même motif
  //     partout), rendu en bouton AUTONOME à côté d'`ActionPrimaire`, pas dans son menu : `peutImprimer`
  //     est un droit de CONSULTATION, décorrélé de `peutGererFacture` (voir sa définition ci-dessus)
  //     — le sortir du menu « … » (qui ne gouverne plus que Corriger/Créer un avoir, les deux
  //     seuls gestes vraiment secondaires) évite qu'un rôle sans aucun droit de gestion, mais qui
  //     PEUT imprimer, se retrouve avec un menu qui n'aurait affiché que cet unique item.
  const actionsSecondairesFacture: ActionSecondaireMenu[] = [
    proposeCorriger
      ? {
          cle: 'corriger',
          libelle: t('facturation:fiche.actions.menu.corriger'),
          onSelect: ouvrirCorrection,
        }
      : null,
    proposeCreerAvoir
      ? {
          cle: 'creerAvoir',
          libelle: t('facturation:fiche.actions.menu.creerAvoir'),
          onSelect: () => navigate(`/factures/${document_.id}/avoir`),
        }
      : null,
  ].filter((action): action is ActionSecondaireMenu => action !== null);

  const boutonActionPrimaire = proposeEmettre ? (
    <Button type="button" onClick={() => setDialogueEmissionOuvert(true)}>
      {documentEstDevis
        ? t('facturation:fiche.actions.envoyerDevis')
        : t('facturation:fiche.actions.emettre')}
    </Button>
  ) : proposeAccord ? (
    <Button type="button" disabled={accord.isPending} onClick={() => accord.mutate(document_.id)}>
      {t('facturation:fiche.actions.accordClient')}
    </Button>
  ) : proposeEncaisser ? (
    <Button type="button" onClick={() => setEncaissementOuvert(true)}>
      {t('facturation:fiche.actions.encaisser')}
    </Button>
  ) : null;

  const actionsEnTete =
    peutImprimer ||
    proposeCorriger ||
    peutPdfDevis ||
    proposeCreerOr ||
    boutonActionPrimaire ||
    actionsSecondairesFacture.length > 0 ? (
      <div className="flex items-center gap-controles">
        {peutPdfDevis ? (
          <Button
            type="button"
            variant="outline"
            disabled={pdfDevis.isPending}
            onClick={() =>
              pdfDevis.mutate({ id: document_.id, nom: document_.numero ?? document_.id })
            }
          >
            <Download aria-hidden className="h-4 w-4" />
            {t('facturation:fiche.actions.telechargerPdf')}
          </Button>
        ) : null}
        {proposeCreerOr ? (
          <Button
            type="button"
            variant={proposeAccord ? 'outline' : 'default'}
            onClick={() => setCreationOrOuverte(true)}
          >
            {t('facturation:fiche.actions.creerOr')}
          </Button>
        ) : null}
        {proposeCorriger ? (
          <Button type="button" variant="outline" onClick={() => setRemplacementOuvert(true)}>
            {t('facturation:fiche.actions.corrigerFacture')}
          </Button>
        ) : null}
        {peutImprimer ? (
          <BoutonImprimerDocument
            url={urlPdf}
            libelle={t('facturation:fiche.actions.menu.imprimer')}
          />
        ) : null}
        {boutonActionPrimaire || actionsSecondairesFacture.length > 0 ? (
          <ActionPrimaire
            actionsSecondaires={actionsSecondairesFacture}
            libelleMenuSecondaire={t('facturation:fiche.actions.autresActions')}
          >
            {boutonActionPrimaire}
          </ActionPrimaire>
        ) : null}
      </div>
    ) : undefined;

  // Fil d'Ariane contextuel (chantier « un seul patron », 24.08.2026) — même dispositif que
  // `EnTeteOrdreReparation.tsx` (pris comme modèle). Un seul ancêtre certain : le contrat ne
  // porte qu'un `vehiculeId` (pas de plaque/désignation en clair sur `ReponseDocumentVente`,
  // voir `document.ts`) — inventer un libellé véhicule depuis le seul id violerait la doctrine
  // « absence de donnée ≠ valeur » ; le lien déjà offert par la Card « Documents liés »
  // (ci-dessous) reste le seul accès à ce véhicule depuis cette fiche.
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    { cle: 'client', libelle: destinataireNom, href: `/clients/${document_.clientId}` },
  ];

  return (
    <GabaritEcran titre={titreDocument} actions={actionsEnTete}>
      <FilAriane segments={segmentsFilAriane} pageCourante={titreDocument} />

      {accord.isError ? (
        <p role="alert" className="texte-corps text-destructive">
          {messageErreur(accord.error, t)}
        </p>
      ) : null}

      {pdfDevis.isError ? (
        <p role="alert" className="texte-corps text-destructive">
          {messageErreur(pdfDevis.error, t)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {documentEstDevis ? (
          <BadgeStatutDevis statut={document_.statut} />
        ) : (
          <BadgeEtatDocument etat={etatAffiche} />
        )}
        {/* Défaut corrigé (issue #80, testeur novice) : cette fiche n'affichait QUE l'état du
            DOCUMENT (« Émise »), jamais l'état du RÈGLEMENT — la liste (`EcranListeFactures.tsx`)
            affichait l'inverse (règlement seul, jamais « Émise »). Même paire de badges, mêmes
            mots, aux deux endroits — voir le commentaire jumeau côté liste. Restreint à `emis` :
            un brouillon (`statutReglement` par défaut, rien n'est dû) ou une facture déjà
            `annule_par_avoir` (`statutReglement` figé d'AVANT l'annulation, `RF-32`) ne doivent
            jamais porter ce badge, même doctrine que la liste. */}
        {!documentEstDevis && etatAffiche === 'emis' && document_.statutReglement ? (
          // Défaut corrigé (issue #129, vocabulaire) : un avoir n'est jamais « réglé »/« non
          // réglé » comme une facture (le sens de l'argent s'inverse — DFA doit au client, un
          // crédit s'IMPUTE, il ne se PAIE pas) — voir le commentaire de `contexte` sur
          // `BadgeStatutReglement`. Les deux badges (document + règlement) restent côte à côte,
          // seul le mot change selon `typeDocument`.
          <BadgeStatutReglement
            statut={document_.statutReglement}
            contexte={document_.typeDocument === 'avoir' ? 'avoir' : 'facture'}
          />
        ) : null}
        {/* Le nom du destinataire N'EST PLUS répété ici (chantier « titres doublés & espacements »,
            17.08.2026, §5.4 « supprimer les redites de vocabulaire ») : la Card « Destinataire »
            ci-dessous l'affiche déjà, en clair et cliquable — le doubler dans cette ligne de
            badges n'apportait rien, et créait deux nœuds de texte identiques pour un même nom
            (risque de sélecteur ambigu en test). Le numéro/type du document vit désormais dans le
            h1 (`titreDocument`, voir plus haut), pas ici non plus. */}
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
        {/* Un devis brouillon n'a pas de date d'émission ; envoyé, il parle d'envoi, pas d'émission. */}
        {documentEstDevis && estBrouillon ? null : (
          <span className="texte-libelle text-muted-foreground">
            {t(documentEstDevis ? 'facturation:fiche.envoyeLe' : 'facturation:fiche.emiseLe', {
              date: formaterDate(document_.dateDocument),
            })}
          </span>
        )}
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

      {estAnnuleeParAvoir && document_.annuleParAvoirId ? (
        // DESIGN.md « bordure structurelle » — encart d'état conservé À DESSEIN (pas un simple
        // groupe de contenu) : il annonce un changement d'état réel du document (annulé par un
        // avoir) qui conditionne les actions disponibles plus bas sur cet écran, même famille que
        // `EncartAvanceClient`.
        <div className="rounded-md border bg-muted px-4 py-3 texte-corps text-foreground">
          {t('facturation:fiche.annuleeParAvoir.message')}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {/* En-tête (badges ci-dessus), puis destinataire et montants côte à côte, lignes, remise
            (brouillon), enfin paiement et documents liés. */}
        <div className="grid items-start gap-6 lg:grid-cols-2">
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
                // DESIGN.md « focus » — `anneau-focus` remplace l'ancienne reconstruction manuelle
                // (`outline-none` + `ring-2 ring-ring ring-offset-2`) : même résultat visuel, une
                // seule source de vérité pour l'anneau de focus dans les deux thèmes.
                className="w-fit rounded-sm text-left texte-corps font-medium text-foreground underline-offset-2 hover:text-primary hover:underline anneau-focus"
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
                // n'a de toute façon aucune correction possible. `libelleAction`/`onAction`
                // omis pour un rôle sans `proposeCorriger` (DÉFAUT CORRIGÉ, voir le commentaire
                // de tête de `proposeCorriger` ci-dessus) : le popover explique toujours pourquoi
                // le champ est figé, mais ne propose plus l'action à qui n'a pas le droit de la
                // déclencher — `ChampVerrouille` n'affiche alors que `message` (voir sa docstring).
                return estBrouillon ? (
                  blocAdresse
                ) : (
                  <ChampVerrouille
                    enfant={blocAdresse}
                    message={messageVerrouille}
                    libelleAction={
                      proposeCorriger ? t('facturation:verrouille.corriger') : undefined
                    }
                    onAction={proposeCorriger ? ouvrirCorrection : undefined}
                  />
                );
              })()}
              {!adresseComplete && !documentEstDevis ? (
                // DESIGN.md « bordure structurelle » — encart d'alerte actionnable conservé (lien
                // « Compléter la fiche » ci-dessous) : c'est le geste concret qui répond au
                // blocage réel d'émission (§4.5, `RefusBloquant`), pas un simple regroupement de
                // texte.
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

          <div className="flex flex-col gap-6">
            <RecapitulatifTVA
              ventilationTva={document_.ventilationTva}
              totalTtcCentimes={document_.totalTtcCentimes}
              devise={document_.devise}
            />

            <div>
              {/* DESIGN.md « densité » — exactement le patron cité par le socle comme candidat
                évident (« une carte, un chiffre, un libellé ») : `Card compact` remplace l'ancien
                `rounded-md border p-4` ad hoc, avec le même rembourrage réduit que ce lot appelait
                de ses vœux. Pas dans une grille CSS (`flex justify-end` seul) : la mise en garde
                « compact aggrave le vide sans `items-start` » ne s'applique pas ici. */}
              <Card compact className="text-right">
                <CardHeader>
                  <p className="texte-libelle text-muted-foreground">
                    {t('facturation:fiche.totalTtc')}
                  </p>
                </CardHeader>
                <CardContent>
                  <p className="texte-chiffre-geant tabular-nums font-semibold text-foreground">
                    {document_.totalTtcCentimes !== undefined
                      ? formaterMontantAvecDevise(document_.totalTtcCentimes, document_.devise)
                      : t('facturation:fiche.montantIndisponible')}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="texte-titre-section">
              {t('facturation:fiche.lignes.titre')}
            </CardTitle>
            {/* Issue #125 : seul geste qui manquait pour qu'un brouillon puisse porter du
                  contenu commercial avant émission. Aucun `peut*(actions)` supplémentaire ici — même
                  doctrine que la Card « Remise globale » juste en dessous, déjà éditable sur tout
                  brouillon sans re-vérification de rôle côté écran (le serveur reste l'arbitre
                  final, `facturation.document.modifier`, `ExigerDroit` sur la route). */}
            {estBrouillon ? (
              <DialogueLigneDocumentVente
                documentId={document_.id}
                enfantDeclencheur={
                  <Button type="button" variant="outline" size="sm">
                    <Plus className="h-4 w-4" aria-hidden />
                    {t('facturation:fiche.lignes.ajouter')}
                  </Button>
                }
              />
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* DÉFAUT CORRIGÉ (voir le commentaire de tête de `proposeCorriger` plus haut) : ce
                  lien était câblé sur `!estBrouillon` SEUL, sans aucun contrôle de rôle — actif
                  pour n'importe quel rôle, y compris `chef_atelier`/`admin`. `proposeCorriger`
                  gouverne désormais L'ACTION elle-même ; un rôle sans droit garde le message
                  informatif (« facture émise, non modifiable »), sans le lien cliquable. */}
            {!estBrouillon && proposeCorriger ? (
              <button
                type="button"
                className="w-fit texte-libelle text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setRemplacementOuvert(true)}
              >
                {messageVerrouille} {t('facturation:verrouille.corriger')}
              </button>
            ) : null}
            {!estBrouillon && !proposeCorriger ? (
              <p className="w-fit texte-libelle text-muted-foreground">{messageVerrouille}</p>
            ) : null}
            {document_.lignes.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('facturation:fiche.lignes.vide')}
              </p>
            ) : (
              <Table>
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
                    {estBrouillon ? (
                      <TableHead className="text-right">
                        <span className="sr-only">{t('commun:actions.modifier')}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {document_.lignes.map((ligne) => {
                    // Une ligne RECOPIÉE d'un OR (`ligneOrId !== null`) n'est jamais éditée ici :
                    // `ligne.ts` (contrat) est explicite — « une ligne issue d'un OR n'est JAMAIS
                    // saisie [en facturation], elle est RECOPIÉE par l'action serveur ». Retenue
                    // par symétrie pour l'édition/suppression : ce dialogue ne sert QUE les
                    // lignes saisies directement ici (vente comptoir, débours, correction),
                    // jamais la provenance OR — décision de ce lot, non tirée d'une ligne
                    // explicite de la spécification, signalée au rapport de livraison.
                    const modifiable = estBrouillon && ligne.ligneOrId === null;
                    return (
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
                          {ligne.montants ? formaterMontant(ligne.montants.montantTtcCentimes) : ''}
                        </TableCell>
                        <TableCell className="text-right texte-libelle text-muted-foreground">
                          {formaterPourmille(ligne.tauxTvaPourmille)}
                        </TableCell>
                        {estBrouillon ? (
                          <TableCell className="text-right">
                            {modifiable ? (
                              <div className="flex justify-end gap-1">
                                <DialogueLigneDocumentVente
                                  documentId={document_.id}
                                  ligne={ligne}
                                  enfantDeclencheur={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={t('facturation:fiche.lignes.modifierAria', {
                                        designation: ligne.designation,
                                      })}
                                    >
                                      <Pencil className="h-4 w-4" aria-hidden />
                                    </Button>
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={
                                    suppressionLigne.isPending &&
                                    suppressionLigne.variables?.ligneId === ligne.id
                                  }
                                  aria-label={t('facturation:fiche.lignes.retirerAria', {
                                    designation: ligne.designation,
                                  })}
                                  onClick={() =>
                                    suppressionLigne.mutate({
                                      documentId: document_.id,
                                      ligneId: ligne.id,
                                    })
                                  }
                                >
                                  {t('facturation:fiche.lignes.retirer')}
                                </Button>
                              </div>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {suppressionLigne.isError ? (
              <p role="alert" className="texte-libelle text-destructive">
                {messageErreur(suppressionLigne.error, t)}
              </p>
            ) : null}
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
            {/* Défaut corrigé (issue #63) : ce bouton mettait bien à jour le total TTC en cas de
                  succès (revalidation visible), mais un ÉCHEC (ex. `409` sur une facture déjà
                  émise entre-temps par un autre poste) ne produisait ICI aucun message — seul le
                  bouton redevenait cliquable. Même patron que `emission.isError`/
                  `suppressionLigne.isError` plus haut sur cet écran. */}
            {modification.isError ? (
              <CardContent className="pt-0">
                {messagesErreurMutation(modification.error, t).map((message, index) => (
                  <p key={index} role="alert" className="texte-libelle text-destructive">
                    {message}
                  </p>
                ))}
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-2">
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
              {document_.dossierVenteId ? (
                <button
                  type="button"
                  className="text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/ventes/dossiers/${document_.dossierVenteId}`)}
                >
                  {t('facturation:fiche.documentsLies.dossierVente')}
                </button>
              ) : null}
              {document_.vehiculeId ? (
                <button
                  type="button"
                  className="text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/vehicules/${document_.vehiculeId}`)}
                >
                  {t('facturation:fiche.documentsLies.vehicule')}
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
              !document_.dossierVenteId &&
              !document_.vehiculeId &&
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
            <DialogTitle>
              {t(
                documentEstDevis
                  ? 'facturation:fiche.dialogueEmission.titreDevis'
                  : 'facturation:fiche.dialogueEmission.titre',
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="texte-corps">
              {t(
                documentEstDevis
                  ? 'facturation:fiche.dialogueEmission.resumeDevis'
                  : 'facturation:fiche.dialogueEmission.resume',
                {
                  destinataire: destinataireNom,
                  montant:
                    document_.totalTtcCentimes !== undefined
                      ? formaterMontantAvecDevise(document_.totalTtcCentimes, document_.devise)
                      : '',
                },
              )}
            </p>
            <p className="texte-corps text-muted-foreground">
              {t(
                documentEstDevis
                  ? 'facturation:fiche.dialogueEmission.avertissementDevis'
                  : 'facturation:fiche.dialogueEmission.avertissement',
              )}
            </p>
            {!adresseComplete && !documentEstDevis ? (
              <p className="texte-libelle text-statut-attention">
                {t('facturation:champs.adresseIncompleteEmission')}
              </p>
            ) : null}
            {/* Issue #125 : `VALIDATION_ECHOUEE` (générique) est le code renvoyé quand ce document
                n'a AUCUNE ligne — `messagesErreurMutation` affiche le VRAI message rédigé par le
                serveur (`erreurs[0].message`) plutôt que le bandeau générique « Certaines
                informations sont incorrectes. » dès qu'il existe (voir sa docstring). */}
            {emission.isError
              ? messagesErreurMutation(emission.error, t).map((message, index) => (
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
            <Button disabled={emission.isPending} onClick={soumettreEmission}>
              {emission.isPending
                ? t(
                    documentEstDevis
                      ? 'facturation:fiche.dialogueEmission.enCoursDevis'
                      : 'facturation:fiche.dialogueEmission.enCours',
                  )
                : t(
                    documentEstDevis
                      ? 'facturation:fiche.dialogueEmission.confirmerDevis'
                      : 'facturation:fiche.dialogueEmission.confirmer',
                  )}
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

      {documentEstDevis ? (
        <DialogueCreerOrDepuisDevis
          devis={document_}
          ouvert={creationOrOuverte}
          onOuvertChange={setCreationOrOuverte}
          onCree={(orId) =>
            navigate(chemins.atelier.ordresReparation.detail(orId, document_.siteId))
          }
        />
      ) : null}

      <DialogueRemplacerFacture
        facture={document_}
        ouvert={remplacementOuvert}
        onOuvertChange={setRemplacementOuvert}
        onSucces={(brouillonId) => navigate(`/factures/${brouillonId}`)}
      />

      <DialogueCorrectionFacture
        facture={document_}
        ouvert={correctionOuverte}
        onOuvertChange={setCorrectionOuverte}
        onSucces={(_avoirNumero, _nouvelleNumero, idNouvelleFacture) =>
          navigate(`/factures/${idNouvelleFacture}`)
        }
      />
    </GabaritEcran>
  );
}

function cnLigne(depuisOr: boolean): string | undefined {
  return depuisOr ? 'bg-muted/30' : undefined;
}
