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
import { formaterDate, formaterMontant } from '@/lib/formats';

import { BadgeStatutReglement } from './BadgeStatutReglement';

const DELAI_DEBOUNCE_MS = 300;

type OngletListeFactures = 'toutes' | 'nonReglees' | 'enRetard' | 'aRelancer';

/**
 * Écran 5 — liste des factures (`design-etape-2-facturation.md` §7). Route attendue : `/factures`,
 * dans la navigation principale (câblage `routes/` hors périmètre de cet agent).
 *
 * ÉCART SIGNALÉ — onglets « En retard » et « À relancer » : le design (§7.1) suppose une donnée de
 * retard (jours d'échéance dépassée, niveau de relance) et un tri dédié sur la LISTE. Ni
 * `schemaFiltresDocumentsVente` (aucun paramètre de filtre sur le retard/la relance) ni
 * `DocumentVenteResume` (aucun champ `relanceNiveau`/`relanceLe` sur la PROJECTION de liste — ils
 * n'existent que sur `ReponseDocumentVente`, le document complet) ne portent cette information à ce
 * jour. Plutôt que de fabriquer un tri ou un badge de retard à partir de rien, ces deux onglets
 * affichent un état explicite qui nomme le manque, jamais une liste réordonnée en silence sur une
 * donnée absente. À lever dès que `DocumentVenteResume`/le filtre de liste exposent le retard.
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

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  // Onglet par défaut : « Non réglées » (§7.1) — reste un badge neutre, l'onglet organise le
  // travail du patron sans l'alarmer.
  const [onglet, setOnglet] = useState<OngletListeFactures>('nonReglees');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const donneeRetardIndisponible = onglet === 'enRetard' || onglet === 'aRelancer';

  const filtres: FiltresDocumentsVente = useMemo(() => {
    const base: FiltresDocumentsVente = {
      typeDocument: ['facture'],
      q: q.trim() === '' ? undefined : q.trim(),
      tri: onglet === 'nonReglees' ? 'dateDocument:asc' : 'dateDocument:desc',
    };
    if (onglet === 'nonReglees') {
      return { ...base, statutReglement: ['non_regle', 'partiel'] };
    }
    return base;
  }, [q, onglet]);

  const { documents, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useListeDocumentsVente(filtres);

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
      rendu: (document_) => <span className="truncate texte-corps text-foreground">{document_.clientDesignation}</span>,
    },
    {
      id: 'emiseLe',
      libelle: t('facturation:liste.colonnes.emiseLe'),
      rendu: (document_) => <span className="texte-libelle text-muted-foreground">{formaterDate(document_.dateDocument)}</span>,
    },
    {
      id: 'montant',
      libelle: t('facturation:liste.colonnes.montant'),
      alignement: 'droite',
      // Absent (jamais 0.00) pour un rôle sans droit aux montants.
      rendu: (document_) => (
        <span className="tabular-nums">{document_.totalTtcCentimes !== undefined ? formaterMontant(document_.totalTtcCentimes) : ''}</span>
      ),
    },
    {
      id: 'statut',
      libelle: t('facturation:liste.colonnes.statut'),
      rendu: (document_) => (document_.statutReglement ? <BadgeStatutReglement statut={document_.statutReglement} /> : null),
    },
    {
      id: 'retard',
      libelle: t('facturation:liste.colonnes.retard'),
      // Voir l'ÉCART SIGNALÉ en tête de fichier : aucune donnée de retard sur la projection de
      // liste — colonne structurellement présente (conforme à la maquette §7.1), toujours vide.
      rendu: () => null,
    },
  ];

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = <EtatVideRecherche titre={t('facturation:liste.titre')} description={t('facturation:liste.vide.recherche')} />;
  } else if (onglet === 'toutes') {
    contenuVide = (
      <EtatVide
        titre={t('facturation:liste.titre')}
        description={t('facturation:liste.vide.premierUsage')}
        note={t('facturation:liste.vide.voirOr')}
      />
    );
  } else if (onglet === 'nonReglees') {
    contenuVide = <EtatVide titre={t('facturation:liste.titre')} description={t('facturation:liste.vide.nonReglees')} />;
  } else if (onglet === 'enRetard') {
    contenuVide = <EtatVide titre={t('facturation:liste.titre')} description={t('facturation:liste.vide.enRetard')} />;
  } else {
    contenuVide = <EtatVide titre={t('facturation:liste.titre')} description={t('facturation:liste.vide.aRelancer')} />;
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

      <BarreFiltres q={qSaisie} onChangeQ={setQSaisie} filtresActifs={q.trim() !== ''} onEffacerFiltres={effacerFiltres} />

      {donneeRetardIndisponible ? (
        <EtatVide
          titre={t('facturation:liste.titre')}
          description={onglet === 'enRetard' ? t('facturation:liste.vide.enRetard') : t('facturation:liste.vide.aRelancer')}
        />
      ) : isPending ? (
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
