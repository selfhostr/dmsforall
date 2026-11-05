import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { DocumentVenteResume, FiltresDocumentsVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useListeDocumentsVente } from '@/hooks/facturation/useListeDocumentsVente';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { BadgeEtatDocument } from './BadgeEtatDocument';
import { BadgeStatutReglement } from './BadgeStatutReglement';
import { peutVoirMontantsFacturation } from './droits';
import { IndicateurRetard } from './IndicateurRetard';

const DELAI_DEBOUNCE_MS = 300;

type OngletListeFactures = 'toutes' | 'nonReglees' | 'enRetard' | 'aRelancer';

// Ordre d'affichage des onglets, réutilisé pour le rendu — `satisfies` garantit que la liste
// reste synchronisée avec `OngletListeFactures` si une valeur est ajoutée ou renommée.
const ONGLETS_LISTE_FACTURES = [
  'toutes',
  'nonReglees',
  'enRetard',
  'aRelancer',
] as const satisfies readonly OngletListeFactures[];

/**
 * Écran 5 — liste des factures (`design-etape-2-facturation.md` §7). Route attendue : `/factures`,
 * dans la navigation principale (câblage `routes/` hors périmètre de ce lot).
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
 *   périmètre de ce lot, à trancher côté l'équipe métier/l'équipe API comme le contrat l'indique.
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
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  // Onglet par défaut : « Non réglées » (§7.1) — reste un badge neutre, l'onglet organise le
  // travail du patron sans l'alarmer.
  const [onglet, setOnglet] = useState<OngletListeFactures>('nonReglees');

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
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
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
            //
            // Défaut corrigé (issue #61, testeur novice) : un `brouillon` portait le badge
            // `BadgeStatutReglement` (« Non réglée ») comme une vraie créance, alors que `statut` et
            // `statutReglement` sont DEUX colonnes délibérément indépendantes (`RF-68`) —
            // `statutReglement: 'non_regle'` n'est qu'une valeur PAR DÉFAUT tant que rien n'a été
            // émis, jamais un signal de créance due. Un brouillon n'est pas encore émis (`numero`/
            // `dateEcheance` valent `null` par construction, `MD-03`/`MD-19`) : rien n'est dû, donc
            // rien à relancer. Même traitement que `annule_par_avoir` ci-dessus — l'état réel
            // (`BadgeEtatDocument`) prime sur l'état de règlement, jamais les deux superposés.
            //
            // Défaut corrigé (issue #80, testeur novice — « Réglée » dans la liste, « Émise » sur la
            // fiche, l'utilisateur ne sait plus si la facture est payée) : `statut` (document verrouillé
            // ou non) et `statutReglement` (créance soldée ou non) sont deux notions ORTHOGONALES et
            // toutes deux légitimes une fois le document `emis` — la liste n'affichait alors QUE le
            // règlement, jamais le mot « Émise », pendant que la fiche (`EcranFicheFacture.tsx`)
            // n'affichait QUE l'état document, jamais le règlement : deux vérités partielles qui se
            // contredisaient en apparence. Les DEUX badges, mêmes mots qu'ailleurs dans l'app, côte à
            // côte — jamais l'un choisi au détriment de l'autre.
            rendu: (document_: DocumentVenteResume) =>
              document_.statut === 'annule_par_avoir' ? (
                <BadgeEtatDocument etat="annule_par_avoir" />
              ) : document_.statut === 'brouillon' ? (
                <BadgeEtatDocument etat="brouillon" />
              ) : document_.statutReglement ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <BadgeEtatDocument etat="emis" />
                  <BadgeStatutReglement statut={document_.statutReglement} />
                </div>
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

  // Titres d'état vide : chacun nomme ce qui MANQUE (jamais « Factures », qui ne ferait que
  // répéter l'onglet actif ET l'entrée de menu — défaut constaté en navigateur par @laupernoe le
  // 17.08.2026, cause : ces cinq états reprenaient tous `facturation:liste.titre`, le même texte
  // que le h1 masqué en `sr-only` par `GabaritEcran`. Même doctrine que `pneus:hangar.vide.titre`
  // (matin du 17.08.2026) — cinq cas distincts (recherche, Toutes, Non réglées, En retard, À
  // relancer), donc cinq libellés distincts, jamais un titre générique recopié.
  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('facturation:liste.vide.recherche.titre')}
        description={t('facturation:liste.vide.recherche.description')}
      />
    );
  } else if (onglet === 'toutes') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.vide.premierUsage.titre')}
        description={t('facturation:liste.vide.premierUsage.description')}
        note={t('facturation:liste.vide.voirOr')}
      />
    );
  } else if (onglet === 'nonReglees') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.vide.nonReglees.titre')}
        description={t('facturation:liste.vide.nonReglees.description')}
      />
    );
  } else if (onglet === 'enRetard') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.vide.enRetard.titre')}
        description={t('facturation:liste.vide.enRetard.description')}
      />
    );
  } else {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.vide.aRelancer.titre')}
        description={t('facturation:liste.vide.aRelancer.description')}
      />
    );
  }

  return (
    // Détection automatique (chantier « titres doublés », retour produit du 17.08.2026, cas cité
    // nommément : « dans Facturation, c'est écrit "Factures" [...] on sait qu'on est dans les
    // factures puisqu'à gauche on a le menu »). Le titre « Factures » fait doublon avec l'onglet
    // « Factures » (OngletsDomaine) ET avec l'entrée de barre latérale « Facturation » n'est pas
    // recalculé ici — `GabaritEcran` masque lui-même le h1 en `sr-only` selon la route courante.
    // Ne PAS poser `titreVisible` : ce re-arbitrage supersède l'ancienne doctrine « il y a écrit
    // Clients, c'est mieux » (12.08.2026), tranchée dans l'autre sens le 17.08.2026 pour ce cas
    // précis. Aucun padding local : le gabarit ne pose ni max-largeur ni remplissage, `AppShell`
    // fournit déjà l'unique `p-4 sm:p-6` de tout écran routé.
    <GabaritEcran titre={t('facturation:liste.titre')}>
      {/* Bascule de VUE à l'intérieur de cet écran (elle ne navigue nulle part — elle change quelles
          factures la même liste affiche), pas un second niveau de NAVIGATION : empilée sous la
          rangée d'onglets d'`OngletsDomaine` (soulignement, `components/ui/tabs.tsx`), une même
          apparence soulignée lisait comme une double barre de navigation ambiguë (retour @laupernoe du
          13.08.2026). Reconstruite sur `@base-ui/react/tabs` directement, avec le style déjà
          retenu pour ce rôle — fond `bg-muted/40`, onglet actif en `bg-background` — même modèle
          que `BasculeVueStock` (`ecrans/ventes/stock/_composants/BasculeVueStock.tsx`, PAS encore
          repris sur cette bibliothèque — signalé hors périmètre de ce correctif). Rôles ARIA et
          clavier inchangés (`tablist`/`tab`, flèches, Home/End, `getByRole('tab', …)`) — seul
          l'habillage change.
          `@base-ui/react/tabs` plutôt que `@radix-ui/react-tabs` (bug e2e mesuré, `aria-valid-
          attr-value` critique WCAG 4.1.2, axe-core, clair ET sombre) : ces onglets FILTRENT une
          liste unique en dessous, ils n'ouvrent jamais un panneau dédié par onglet (aucun
          `TabsContent`/`TabsPanel` — la liste + ses états chargement/vide/erreur restent rendus
          UNE fois, hors `Tabs`, filtrés par `onglet`). Radix calcule `aria-controls` sur chaque
          `Trigger` à partir d'un id DÉTERMINISTE (`<base>-content-<value>`) qu'aucun panneau ne
          porte jamais ici — référence cassée dans les quatre onglets, en permanence. Base UI
          calcule `aria-controls` à partir des panneaux RÉELLEMENT montés (`TabsRoot.js`,
          `getTabPanelIdByValue`/`registerMountedTabPanel`) : sans `TabsPanel` du tout, l'attribut
          est simplement OMIS (React n'écrit jamais un attribut `undefined`) — rien à référencer,
          rien d'invalide, sans avoir à fabriquer un panneau qui n'existerait que pour satisfaire
          l'attribut. Piste « un vrai `TabsPanel` par onglet » écartée : forcerait `forceMount`
          sur les quatre pour que les `aria-controls` des onglets INACTIFS restent valides en
          permanence (Radix/Base UI ne montent QUE le panneau actif sans lui), donc quatre
          `<div role="tabpanel">` montés en clavier/lecteur d'écran en permanence à masquer
          soi-même en CSS — plus de code, plus de risque, pour un problème que l'absence de
          panneau évite structurellement. Piste « radiogroup » écartée aussi : chaque onglet change
          RÉELLEMENT quel jeu de factures s'affiche (pas un simple tri) — la sémantique « tabs »
          reste honnête, seule la bibliothèque posait un attribut invalide. */}
      <TabsPrimitive.Root
        value={onglet}
        onValueChange={(valeur) => setOnglet(valeur as OngletListeFactures)}
      >
        <TabsPrimitive.List
          aria-label={t('facturation:liste.onglets.groupeLabel')}
          className="inline-flex items-stretch gap-1 rounded-md border bg-muted/40 p-1"
        >
          {ONGLETS_LISTE_FACTURES.map((valeur) => (
            <TabsPrimitive.Tab
              key={valeur}
              value={valeur}
              className={cn(
                'flex h-9 items-center whitespace-nowrap rounded-sm px-3 texte-corps font-medium transition-colors',
                'anneau-focus',
                'text-muted-foreground hover:text-foreground',
                'data-active:bg-background data-active:font-semibold data-active:text-foreground data-active:shadow-sm',
              )}
            >
              {t(`facturation:liste.onglets.${valeur}`)}
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>
      </TabsPrimitive.Root>

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
    </GabaritEcran>
  );
}
