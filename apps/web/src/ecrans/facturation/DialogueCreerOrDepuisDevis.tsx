import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntreeCreationOrdreDepuisDevis, ReponseDocumentVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { useCreerOrdreDepuisDevis } from '@/hooks/facturation/useCreerOrdreDepuisDevis';

interface Props {
  readonly devis: ReponseDocumentVente;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Appelé avec l'identifiant de l'OR créé (l'écran navigue vers sa fiche). */
  readonly onCree: (orId: string) => void;
}

/**
 * « Créer l'OR » depuis un devis : client, véhicule et lignes viennent du devis (le serveur les
 * reprend), seul le kilométrage d'entrée se saisit ici. Une condition à confirmer (client bloqué,
 * deux OR sur le véhicule…) s'affiche dans la même fenêtre : le garagiste décide, la saisie reste.
 */
export function DialogueCreerOrDepuisDevis({ devis, ouvert, onOuvertChange, onCree }: Props) {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs']);
  const creation = useCreerOrdreDepuisDevis();
  const [kilometrage, setKilometrage] = useState<number | null>(null);

  // Les défauts du schéma (unité, demandes, statut initial) sont posés ici : le type de sortie de
  // `schemaCreationOrdreDepuisDevis` les exige, le serveur les redéfinirait à l'identique.
  const entree: EntreeCreationOrdreDepuisDevis = {
    kilometrageEntree: kilometrage,
    uniteKilometrage: 'km',
    demandes: [],
    statutInitial: 'ouvert',
  };
  const aConfirmer = creation.confirmationsRequises.length > 0;

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('facturation:devis.creerOr.titre')}</DialogTitle>
          <DialogDescription>
            {t('facturation:devis.creerOr.description', {
              destinataire: devis.figees.clientDesignation,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <ChampKilometrage
            valeur={kilometrage}
            onChangeValeur={setKilometrage}
            unite="km"
            label={t('facturation:devis.creerOr.kilometrage')}
            disabled={creation.enCours}
          />
          <p className="texte-libelle text-muted-foreground">
            {t('facturation:devis.creerOr.kilometrageAide')}
          </p>
        </div>
        {creation.erreur ? (
          <p role="alert" className="texte-corps text-statut-attention">
            {messageErreur(creation.erreur, t)}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          {aConfirmer ? (
            <Button
              disabled={creation.enCours}
              onClick={() =>
                creation.confirmerEtResoumettre(
                  { devisId: devis.id, entree },
                  creation.confirmationsRequises,
                  onCree,
                )
              }
            >
              {t('commun:actions.continuerQuandMeme')}
            </Button>
          ) : (
            <Button
              disabled={creation.enCours}
              onClick={() => creation.soumettre({ devisId: devis.id, entree }, onCree)}
            >
              {creation.enCours
                ? t('facturation:devis.creerOr.enCours')
                : t('facturation:devis.creerOr.confirmer')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
