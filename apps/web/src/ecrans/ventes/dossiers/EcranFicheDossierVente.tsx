import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { CarteFinancement } from '@/ecrans/ventes/financements/CarteFinancement';
import { CarteReprise } from '@/ecrans/ventes/reprises/CarteReprise';
import { useSession } from '@/hooks/useSession';
import { useDossierVente } from '@/hooks/ventes/dossiers/useDossierVente';

import { CarteDocumentsRequis } from './CarteDocumentsRequis';
import { CarteDocumentsVente } from './CarteDocumentsVente';
import { DialogueModifierDossierVente } from './DialogueModifierDossierVente';
import { EnTeteDossierVente } from './EnTeteDossierVente';
import { PanneauActionsDossierVente } from './PanneauActionsDossierVente';

/**
 * Fiche dossier de vente (design §7) — le cœur du module. Une seule requête PRIMAIRE bloque
 * l'écran entier (`GET /dossiers-vente/{id}`, déjà le document COMPLET : reprise, financement
 * courant + historique, documents, documents requis — même doctrine que `GET /ordres-reparation/{id}`,
 * D-10), pas d'agrégation d'écran a posteriori.
 *
 * `dossier.actionsDisponibles` gouverne à la fois `PanneauActionsDossierVente` (transitions) ET
 * la disponibilité du geste `modifier` (PATCH) — `'modifier'` est un membre littéral de
 * `ACTIONS_DOSSIER_VENTE` (voir la note de `enums.ts`) et déjà calculé côté serveur en tenant
 * compte du rôle courant (`calculerActionsDisponiblesDossierVente(statut, role)`,
 * `apps/api/src/ventes/mappers.ts`) : ce composant lit ce signal directement plutôt que de
 * dupliquer une seconde matrice de droits pour ce seul geste (contrairement aux transitions
 * exposées par `PanneauActionsDossierVente`, qui ont chacune leur propre droit `ventes.dossier.*`
 * mais suivent la même logique serveur).
 *
 * `CarteReprise`/`CarteFinancement` (branchées ici, pas leurs anciennes variantes
 * `CarteRepriseResume`/`CarteFinancementResume` en lecture seule — supprimées, plus aucun
 * appelant) portent elles-mêmes le masquage par rôle (`peutLireReprise`/`peutLireFinancement`,
 * chacune dans son propre `droits.ts` sous `ecrans/ventes/{reprises,financements}/`) : un rôle
 * sans droit de lecture ne voit STRICTEMENT RIEN de la section, pas une carte vide ni un bouton
 * grisé. `onMutationReussie` recharge la requête PRIMAIRE de cette fiche (`requete.refetch()`) —
 * seule source de vérité de `dossier.reprise`/`dossier.financement` embarqués ; ni `CarteReprise`
 * ni `CarteFinancement` n'écrivent dans ce cache dossier elles-mêmes (voir l'en-tête de
 * `hooks/ventes/reprises/useCreerReprise.ts`).
 */
export function EcranFicheDossierVente() {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const [modificationOuverte, setModificationOuverte] = useState(false);

  const requete = useDossierVente(id);
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.fiche.titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.fiche.titre')}</h1>
        <EtatErreur
          titre={t('ventes:dossier.fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const dossier = requete.data;
  const peutModifier = dossier.actionsDisponibles.includes('modifier');

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="texte-titre-section font-semibold text-foreground">
          {t('ventes:dossier.fiche.titre')}
        </h1>
        {peutModifier ? (
          <Button variant="outline" onClick={() => setModificationOuverte(true)}>
            {t('commun:actions.modifier')}
          </Button>
        ) : null}
      </div>

      <EnTeteDossierVente
        dossier={dossier}
        peutAssignerVehicule={peutModifier && dossier.statut === 'prospection'}
        onAssignerVehicule={() => setModificationOuverte(true)}
      />

      <PanneauActionsDossierVente dossier={dossier} />

      <CarteReprise
        dossierVenteId={dossier.id}
        possedeReprise={dossier.reprise !== null}
        role={role}
        onMutationReussie={() => void requete.refetch()}
      />

      <CarteFinancement
        dossierVenteId={dossier.id}
        financement={dossier.financement ?? null}
        financements={dossier.financements ?? []}
        financementsTronques={dossier.financementsTronques ?? false}
        statutDossierVente={dossier.statut}
        role={role}
        onMutationReussie={() => void requete.refetch()}
      />

      <CarteDocumentsVente
        documents={dossier.documents}
        documentsTronques={dossier.documentsTronques}
      />

      <CarteDocumentsRequis
        dossierVenteId={dossier.id}
        documentsRequis={dossier.documentsRequis}
        peutModifier={peutModifier}
      />

      {peutModifier ? (
        <DialogueModifierDossierVente
          dossier={dossier}
          ouvert={modificationOuverte}
          onOuvertChange={setModificationOuverte}
        />
      ) : null}
    </div>
  );
}
