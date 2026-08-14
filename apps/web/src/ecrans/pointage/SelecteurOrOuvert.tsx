import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useListeOrdresReparation } from '@/hooks/atelier/useListeOrdresReparation';
import { statutOrPointable } from '@/hooks/pointage/statuts-or-pointables';

const DELAI_DEBOUNCE_MS = 300;

interface Props {
  /** `undefined` -> pas de filtre de site (liste tenant entière). Un technicien/une direction
   *  multi-site qui n'a pas encore choisi de site (voir `SelecteurSitePointage`) reste capable de
   *  chercher une OR : le filtre de site est un confort, jamais une condition d'accès (même
   *  principe que `useMesOrdresAssignes`, qui ne filtre déjà pas par site). */
  readonly siteId: string | undefined;
  readonly onChoisirOr: (orId: string) => void;
  readonly disabled?: boolean;
}

/**
 * « Toutes les OR ouvertes » — recherche libre + liste, indépendante de toute assignation
 * (`ligne_or.technicienId`). Correctif #148 : avant ce composant, la SEULE porte d'entrée pour
 * démarrer un pointage était « Mes OR du jour » (`useMesOrdresAssignes`), un filtre de CONFORT côté
 * front — le serveur (`ServicePointage.demarrer`) n'a jamais exigé d'assignation, seuls le site et
 * le statut pointable de l'OR comptent (voir l'en-tête d'`EcranPointageTechnicien.tsx`). Un rôle
 * d'encadrement (direction, chef d'atelier) qui n'a — normalement — aucune ligne assignée se
 * heurtait donc à un mur purement décoratif : ce composant lui donne un second chemin, légal côté
 * serveur depuis toujours.
 *
 * AUCUN filtre `statut` sur la requête (CORRECTIF, test manuel 14.08.2026) : `statut: 'ouvert'`
 * rendait une OR `en_cours` — précisément la cible la plus probable d'un technicien qui cherche à
 * pointer — introuvable par ce chemin, alors qu'elle reste légitimement pointable (RM-92). La liste
 * NON filtrée par statut est donc chargée puis réduite CÔTÉ CLIENT à `statutOrPointable`
 * (`hooks/pointage/statuts-or-pointables.ts`, MIROIR du prédicat serveur `estOrPointable`) —
 * `FiltresListeOrdresReparation.statut` (`hooks/atelier/ordres-reparation.api.ts`, hors périmètre
 * d'écriture de ce module) reste mono-sélection, un filtre serveur multi-statuts serait la solution
 * idéale mais exige de toucher ce contrat, signalé au coordinateur plutôt que bricolé ici.
 *
 * Choisir une OR ici ouvre EXACTEMENT le même `DialogueChoixCiblePointage` que « Mes OR du jour »
 * (l'appelant partage le même `orSelectionneId` / `onChoisirOr`) — aucune mécanique dupliquée.
 */
export function SelecteurOrOuvert({ siteId, onChoisirOr, disabled = false }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const requete = useListeOrdresReparation({ q, siteId, tri: 'ouvertLe:desc' });
  // Filtre CÔTÉ CLIENT — voir la docstring de tête, § « AUCUN filtre `statut` sur la requête ».
  const ordresPointables = requete.ordres.filter((or) => statutOrPointable(or.statut));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pointage-recherche-toutes-or">
          {t('pointage:toutesLesOr.rechercherLabel')}
        </Label>
        <Input
          id="pointage-recherche-toutes-or"
          value={qSaisie}
          onChange={(evenement) => setQSaisie(evenement.target.value)}
          placeholder={t('pointage:toutesLesOr.rechercherPlaceholder')}
        />
      </div>

      {requete.isPending ? <EtatChargement lignes={3} /> : null}

      {requete.isError ? (
        <EtatErreur
          titre={t('pointage:technicien.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : null}

      {!requete.isPending && !requete.isError && ordresPointables.length === 0 ? (
        <EtatVide titre={t('pointage:toutesLesOr.aucunResultat')} description="" />
      ) : null}

      {!requete.isPending && !requete.isError && ordresPointables.length > 0 ? (
        <div className="flex flex-col gap-2">
          {ordresPointables.map((or) => (
            <button
              key={or.id}
              type="button"
              disabled={disabled}
              onClick={() => onChoisirOr(or.id)}
              className="flex min-h-[56px] flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium">{or.numero}</span>
              <div className="flex flex-col items-start gap-0.5 sm:items-end">
                <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
                <IdentiteClient client={or.client} />
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
