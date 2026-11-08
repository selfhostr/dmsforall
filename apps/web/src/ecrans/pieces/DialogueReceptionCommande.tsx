import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntreeReceptionCommandeFournisseur, ReponseCommandeFournisseur } from '@dfa/shared';

import { useCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useDesignationsArticles } from '@/hooks/pieces/useDesignationsArticles';
import { useReceptionnerCommandeFournisseur } from '@/hooks/pieces/useTransitionsCommandeFournisseur';

import { messageErreurMutation } from './messages-erreur-mutation';
import { quantiteMilliemeVersSaisie, saisieVersQuantiteMillieme } from './utils';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly commande: ReponseCommandeFournisseur;
}

interface LigneSaisie {
  readonly selectionnee: boolean;
  readonly quantiteSaisie: string;
  readonly prixReelCentimes: number | null;
  readonly motif: string;
}

function etatInitial(commande: ReponseCommandeFournisseur): Record<string, LigneSaisie> {
  const etat: Record<string, LigneSaisie> = {};
  for (const ligne of commande.lignes) {
    if (ligne.quantiteReliquatMillieme <= 0 || ligne.reliquatAnnuleLe !== null) continue;
    etat[ligne.id] = {
      selectionnee: false,
      quantiteSaisie: quantiteMilliemeVersSaisie(ligne.quantiteReliquatMillieme),
      prixReelCentimes: ligne.prixAchatAttenduCentimes,
      motif: '',
    };
  }
  return etat;
}

/**
 * Réception d'une commande fournisseur, partielle ou totale (§7.4, priorité 1 du lot) —
 * `Idempotency-Key` obligatoire (génère un mouvement `entree_livraison` PAR ligne cochée).
 * Le magasinier saisit ce qui est EFFECTIVEMENT livré : seules les lignes COCHÉES entrent dans la
 * requête (`schemaLigneReceptionCommandeFournisseur` exige `quantiteRecueMillieme >= 1` — une
 * ligne non livrée cette fois ne se soumet pas à `0`, elle est simplement absente du corps).
 *
 * Substitution de référence (`articleRecuId`, RP-29 « le fournisseur a substitué une équivalente
 * sans prévenir ») délibérément HORS de ce dialogue — cas d'anomalie de réception, pas le geste
 * nominal ; couche transport déjà prête (`EntreeReceptionCommandeFournisseur.lignes[].articleRecuId`)
 * pour un futur écran d'anomalie dédié.
 */
export function DialogueReceptionCommande({ ouvert, onOuvertChange, commande }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const idempotence = useCleIdempotence();
  const receptionner = useReceptionnerCommandeFournisseur(commande.id);
  const designations = useDesignationsArticles(commande.lignes.map((ligne) => ligne.articleId));

  const [lignes, setLignes] = useState<Record<string, LigneSaisie>>(() => etatInitial(commande));
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  useEffect(() => {
    if (ouvert) {
      setLignes(etatInitial(commande));
      setErreurValidation(null);
    }
    // `commande` délibérément absent des dépendances : la réinitialisation ne doit se produire
    // qu'à l'OUVERTURE du dialogue (`ouvert` bascule à `true`), jamais à chaque changement de
    // référence de `commande` (ex. re-fetch en arrière-plan pendant la saisie) — même choix que
    // `DialogueMouvementStock` (`siteParDefaut` seul en dépendance, pas les `sites`).
  }, [ouvert]);

  const lignesReceptionnables = commande.lignes.filter(
    (ligne) => ligne.quantiteReliquatMillieme > 0 && ligne.reliquatAnnuleLe === null,
  );

  function majLigne(ligneId: string, patch: Partial<LigneSaisie>) {
    setLignes((valeur) => ({
      ...valeur,
      [ligneId]: { ...valeur[ligneId], ...patch } as LigneSaisie,
    }));
  }

  function soumettre() {
    setErreurValidation(null);
    const lignesSelectionnees = Object.entries(lignes).filter(([, saisie]) => saisie.selectionnee);
    if (lignesSelectionnees.length === 0) {
      setErreurValidation(t('pieces:commandes.reception.aucuneLigne'));
      return;
    }

    const corpsLignes: EntreeReceptionCommandeFournisseur['lignes'] = [];
    for (const [ligneId, saisie] of lignesSelectionnees) {
      const quantiteRecueMillieme = saisieVersQuantiteMillieme(saisie.quantiteSaisie);
      if (quantiteRecueMillieme === null) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      corpsLignes.push({
        ligneId,
        quantiteRecueMillieme,
        prixAchatReelCentimes: saisie.prixReelCentimes,
        motif: saisie.motif.trim() === '' ? undefined : saisie.motif.trim(),
      });
    }

    receptionner.mutate(
      { entree: { lignes: corpsLignes }, idempotencyKey: idempotence.cle },
      {
        onSuccess: () => {
          idempotence.regenerer();
          onOuvertChange(false);
        },
      },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('pieces:commandes.reception.titre')}
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={receptionner.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={receptionner.isPending} onClick={soumettre}>
            {receptionner.isPending
              ? t('commun:chargement.enCours')
              : t('pieces:commandes.actions.receptionner')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-groupe">
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        {lignesReceptionnables.map((ligne) => {
          const saisie = lignes[ligne.id];
          if (!saisie) return null;
          const libelleLigne = t('pieces:commandes.reception.ligneNumero', {
            numero: ligne.numeroOrdre,
          });
          const designation = designations.get(ligne.articleId);
          const nomLigne = designation ? `${libelleLigne} — ${designation}` : libelleLigne;
          return (
            // Bordure CONSERVÉE (DESIGN.md) : regroupe une case à cocher + des champs de
            // saisie réels (quantité, prix), pas un simple groupe de contenu passif.
            <div key={ligne.id} className="flex flex-col gap-controles rounded-md border p-3">
              <label
                htmlFor={`reception-ligne-${ligne.id}`}
                className="flex items-center gap-2 texte-corps font-medium"
              >
                <Checkbox
                  id={`reception-ligne-${ligne.id}`}
                  checked={saisie.selectionnee}
                  onCheckedChange={(coche) => majLigne(ligne.id, { selectionnee: coche === true })}
                  disabled={receptionner.isPending}
                />
                {nomLigne}
                <span className="texte-libelle text-muted-foreground font-normal">
                  {t('pieces:commandes.lignes.quantiteReliquat')} :{' '}
                  {quantiteMilliemeVersSaisie(ligne.quantiteReliquatMillieme)}
                </span>
              </label>

              {saisie.selectionnee ? (
                <div className="grid grid-cols-2 gap-controles">
                  <div className="flex flex-col gap-champ">
                    <Label htmlFor={`recep-qte-${ligne.id}`} requis>
                      {t('pieces:commandes.lignes.quantiteRecue')}
                    </Label>
                    <Input
                      id={`recep-qte-${ligne.id}`}
                      type="text"
                      inputMode="decimal"
                      required
                      aria-label={`${t('pieces:commandes.lignes.quantiteRecue')} — ${nomLigne}`}
                      readOnly={receptionner.isPending}
                      value={saisie.quantiteSaisie}
                      onChange={(evenement) =>
                        majLigne(ligne.id, { quantiteSaisie: evenement.target.value })
                      }
                    />
                  </div>
                  <ChampMontant
                    id={`recep-prix-${ligne.id}`}
                    label={t('pieces:commandes.lignes.prixAchatReel')}
                    nomAccessible={`${t('pieces:commandes.lignes.prixAchatReel')} — ${nomLigne}`}
                    disabled={receptionner.isPending}
                    valeurCentimes={saisie.prixReelCentimes}
                    onChangeCentimes={(centimes) =>
                      majLigne(ligne.id, { prixReelCentimes: centimes })
                    }
                  />
                  <div className="col-span-2 flex flex-col gap-champ">
                    <Label htmlFor={`recep-motif-${ligne.id}`}>
                      {t('pieces:commandes.lignes.motif')}
                    </Label>
                    <Input
                      id={`recep-motif-${ligne.id}`}
                      aria-label={`${t('pieces:commandes.lignes.motif')} — ${nomLigne}`}
                      readOnly={receptionner.isPending}
                      value={saisie.motif}
                      onChange={(evenement) =>
                        majLigne(ligne.id, { motif: evenement.target.value })
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {erreurValidation ? (
          <p className="texte-libelle text-destructive" role="alert">
            {erreurValidation}
          </p>
        ) : null}
        {receptionner.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreurMutation(receptionner.error, t)}
          </p>
        ) : null}
      </div>
    </PanneauLateral>
  );
}
