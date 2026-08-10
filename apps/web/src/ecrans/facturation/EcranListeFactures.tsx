import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { DocumentVenteResume, FiltresDocumentsVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { useListeDocumentsVente } from '@/hooks/facturation/useListeDocumentsVente';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { BadgeEtatDocument } from './BadgeEtatDocument';
import { BadgeStatutReglement } from './BadgeStatutReglement';
import { peutVoirMontantsFacturation } from './droits';
import { IndicateurRetard } from './IndicateurRetard';

const DELAI_DEBOUNCE_MS = 300;

type OngletListeFactures = 'toutes' | 'nonReglees' | 'enRetard' | 'aRelancer';

/**
 * Écran 5 — liste des factures (`design-etape-2-facturation.md` §7). Route attendue : `/factures`,
 * dans la navigation principale (câblage `routes/` hors périmètre de cet agent).
 *
 * ONGLETS « EN RETARD » ET « À RELANCER » — câblés sur de vrais paramètres de requête serveur
 * (`schemaFiltresDocumentsVente.enRetard`/`.relanceNiveau`, `packages/shared/src/contrats/
 * facturation/document.ts`), plus de filtrage côté client : l'ancien commentaire qui justifiait un
 * état « donnée indisponible » statique sur ces deux onglets décrivait un contrat qui n'expose plus
 * cette lacune — le laisser en l'état aurait fait mentir l'écran (deux onglets affichant « tout est
 * à jour » alors que des factures en retard existaient bel et bien, confirmé en navigateur sur le
 * jeu de démo : `2026-00002`, 176 jours de retard, `2026-00001`, 5 jours).
 * - « En retard » : `enRetard: true` — même définition que `ReponseDocumentVente.enRetard`
 *   (`echeance.ts::calculerRetardDocument`), aucun filtre sur `relanceNiveau`.
 * - « À relancer » : le contrat porte une AMBIGUÏTÉ SIGNALÉE, non tranchée, sur `relanceNiveau`
 *   (voir le commentaire au-dessus de ce champ dans `document.ts`) — l'onglet pourrait vouloir dire
 *   « en retard ET jamais relancée » (`enRetard=true&relanceNiveau=0`, EXPLICITEMENT cité par le
 *   contrat comme couvrant « déjà le cas usuel ») ou « en retard, relancée, palier suivant pas
 *   atteint » (sémantique de seuil non exprimable par ce schéma de filtre, tenant-dépendante). Choix
 *   retenu ici, EN CITANT le contrat : `enRetard=true&relanceNiveau=0` — la seule primitive qui
 *   repose sur une colonne réelle et couvre le cas usuel ; le raffinement par seuil reste hors
 *   périmètre de cet agent, à trancher côté expert-metier/expert-api comme le contrat l'indique.
 *
 * ÉCART SIGNALÉ — accélérateur « Encaisser » au survol de ligne (§7.1, risque n°2 du design) :
 * NON implémenté ici. `DocumentVenteResume` ne porte pas `siteId` (seulement `document.ts` §
 * `ReponseDocumentVente`, le document complet, l'expose) — `SheetEncaissement` en a pourtant besoin
 * pour `POST /paiements`. Ouvrir le panneau depuis cette liste sans `siteId` réel enverrait un site
 * faux ou vide sur une création sensible : plus risqué que l'absence du raccourci. L'accélérateur
 * peut être ajouté dès que la projection de liste porte `siteId`, ou en faisant d'abord un `GET
 * /documents-vente/{id}` avant ouverture (perd l'intérêt d'un raccourci « sans passer par la fiche
 * complète »).
 */
export function EcranListeFactures() {
  const { t } = useTranslation(['facturation', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  // Tant que la session n'est pas résolue, `role === undefined` -> `peutVoirMontantsFacturation`
  // rend `false` -> la colonne « Retard » reste absente jusqu'à confirmation du droit. Jamais
  // l'inverse (colonne visible puis retirée) : cette direction est la seule qui ne fait pas
  // clignoter le tableau (même principe que `autoriseFinancier` sur `EcranTableauBord`).
  const voitMontantsFacturation = peutVoirMontantsFacturation(role);

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  // Onglet par défaut : « Non réglées » (§7.1) — reste un badge neutre, l'onglet organise le
  // travail du patron sans l'alarmer.
  const [onglet, setOnglet] = useState<OngletListeFactures>('nonReglees');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const filtres: FiltresDocumentsVente = useMemo(() => {
    const base: FiltresDocumentsVente = {
      typeDocument: ['facture'],
      q: q.trim() === '' ? undefined : q.trim(),
      tri: onglet === 'nonReglees' ? 'dateDocument:asc' : 'dateDocument:desc',
    };
    if (onglet === 'nonReglees') {
      // `statut: ['emis']` — même correctif que `useFacturesOuvertesClient` (`hooks/facturation/`) :
      // `statutReglement` seul laissait passer une facture `annule_par_avoir`, qui conserve le
      // `statutReglement` d'avant son annulation (`RF-32` ne le nettoie pas). Sans ce filtre,
      // l'onglet « Non réglées » proposait comme dette active une créance déjà éteinte par avoir.
      return { ...base, statut: ['emis'], statutReglement: ['non_regle', 'partiel'] };
    }
    if (onglet === 'enRetard') {
      return { ...base, enRetard: true };
    }
    if (onglet === 'aRelancer') {
      // Choix cité en tête de fichier : `enRetard=true&relanceNiveau=0`, la primitive que le
      // contrat désigne explicitement comme couvrant « déjà le cas usuel » « en retard, jamais
      // relancée » — pas une égalité de seuil sur le palier de relance suivant (non exprimable ici).
      return { ...base, enRetard: true, relanceNiveau: 0 };
    }
    return base;
  }, [q, onglet]);

  const {
    documents,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeDocumentsVente(filtres);

  function effacerFiltres() {
    setQSaisie('');
    setQ('');
  }

  const colonnes: ColonneComptoir<DocumentVenteResume>[] = [
    {
      id: 'numero',
      libelle: t('facturation:liste.colonnes.numero'),
      rendu: (document_) => <span className="font-medium text-foreground">{document_.numero}</span>,
    },
    {
      id: 'client',
      libelle: t('facturation:liste.colonnes.client'),
      // `clientDesignation` est la valeur FIGÉE du document (§8.3 de `document.ts`) — un document
      // liste sa propre identité figée, pas celle vivante du client (pas de `ClientResume` imbriqué
      // sur `DocumentVenteResume`, donc pas de `IdentiteClient` ici).
      rendu: (document_) => (
        <span className="truncate texte-corps text-foreground">{document_.clientDesignation}</span>
      ),
    },
    {
      id: 'emiseLe',
      libelle: t('facturation:liste.colonnes.emiseLe'),
      rendu: (document_) => (
        <span className="texte-libelle text-muted-foreground">
          {formaterDate(document_.dateDocument)}
        </span>
      ),
    },
    // `montant`, `statut` et `retard` sont TOUTES LES TROIS structurellement ABSENTES (ni en-tête
    // ni cellule, colonne entière retirée du tableau) pour un rôle sans droit financier — jamais
    // une colonne présente à cellules vides : le serveur masque déjà `totalTtcCentimes`/
    // `statutReglement`/`dateEcheance`/`enRetard`/`joursRetard` (champs `?:` absents, jamais
    // `null`/`0`, voir `droits.ts`), donc une colonne construite quand même rendrait un tableau
    // entièrement vide sur toutes les lignes — du bruit visuel sans contrepartie, jamais la
    // doctrine du produit (un rôle sans droit ne voit pas un vide, il ne voit rien).
    ...(voitMontantsFacturation
      ? [
          {
            id: 'montant',
            libelle: t('facturation:liste.colonnes.montant'),
            alignement: 'droite' as const,
            // `devise` (`CHF`/`EUR`, migration `0015`) voyage jusqu'au front sur CHAQUE document —
            // affichée avec le montant plutôt qu'assumée en CHF : le front ne CRÉE qu'en CHF
            // aujourd'hui, mais un document repris ou créé par API peut porter `EUR`, et rien ne
            // doit se lire comme un montant suisse s'il ne l'est pas.
            rendu: (document_: DocumentVenteResume) => (
              <span className="tabular-nums">
                {document_.totalTtcCentimes !== undefined
                  ? `${document_.devise} ${formaterMontant(document_.totalTtcCentimes)}`
                  : ''}
              </span>
            ),
          },
          {
            id: 'statut',
            libelle: t('facturation:liste.colonnes.statut'),
            // L'onglet « Toutes » n'a AUCUN filtre `statut` (§ tête de fichier, correctif
            // `nonReglees` ci-dessus) : une facture `annule_par_avoir` y reste visible — l'écran ne
            // doit jamais donner l'impression qu'elle n'a pas existé. Mais son `statutReglement`
            // (`non_regle`/`partiel`) est celui d'AVANT l'annulation (`RF-32` ne le nettoie pas) :
            // afficher ce badge sur une créance déjà éteinte par avoir la ferait lire comme une
            // dette active. `BadgeEtatDocument` (déjà utilisé sur la fiche facture) rend l'état réel
            // à la place, jamais les deux superposés.
            rendu: (document_: DocumentVenteResume) =>
              document_.statut === 'annule_par_avoir' ? (
                <BadgeEtatDocument etat="annule_par_avoir" />
              ) : document_.statutReglement ? (
                <BadgeStatutReglement statut={document_.statutReglement} />
              ) : null,
          },
          {
            id: 'retard',
            libelle: t('facturation:liste.colonnes.retard'),
            rendu: (document_: DocumentVenteResume) => (
              <IndicateurRetard
                dateEcheance={document_.dateEcheance}
                enRetard={document_.enRetard}
                joursRetard={document_.joursRetard}
              />
            ),
          },
        ]
      : []),
  ];

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.recherche')}
      />
    );
  } else if (onglet === 'toutes') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.premierUsage')}
        note={t('facturation:liste.vide.voirOr')}
      />
    );
  } else if (onglet === 'nonReglees') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.nonReglees')}
      />
    );
  } else if (onglet === 'enRetard') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.enRetard')}
      />
    );
  } else {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.aRelancer')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('facturation:liste.titre')}</h1>

      <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as OngletListeFactures)}>
        <TabsList>
          <TabsTrigger value="toutes">{t('facturation:liste.onglets.toutes')}</TabsTrigger>
          <TabsTrigger value="nonReglees">{t('facturation:liste.onglets.nonReglees')}</TabsTrigger>
          <TabsTrigger value="enRetard">{t('facturation:liste.onglets.enRetard')}</TabsTrigger>
          <TabsTrigger value="aRelancer">{t('facturation:liste.onglets.aRelancer')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        filtresActifs={q.trim() !== ''}
        onEffacerFiltres={effacerFiltres}
      />

      {isPending ? (
        <EtatChargement lignes={6} />
      ) : isError ? (
        <EtatErreur
          titre={t('facturation:liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      ) : (
        <>
          <TableComptoir
            colonnes={colonnes}
            lignes={documents}
            cleLigne={(document_) => document_.id}
            onOuvrirLigne={(document_) => navigate(`/factures/${document_.id}`)}
            libelleLigne={(document_) =>
              t('commun:actions.ouvrirElement', { nom: document_.numero })
            }
            contenuVide={contenuVide}
          />
          <BoutonChargerPlus
            aChargerPlus={Boolean(hasNextPage)}
            enChargement={isFetchingNextPage}
            onChargerPlus={() => void fetchNextPage()}
          />
        </>
      )}
    </div>
  );
}
