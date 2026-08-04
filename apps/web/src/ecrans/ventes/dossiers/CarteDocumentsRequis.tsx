import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DocumentRequisDossierVente } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useMarquerDocumentRequisDossierVente } from '@/hooks/ventes/dossiers/useMarquerDocumentRequisDossierVente';
import { formaterDateHeure } from '@/lib/formats';

interface Props {
  readonly dossierVenteId: string;
  readonly documentsRequis: readonly DocumentRequisDossierVente[];
  readonly peutModifier: boolean;
}

/**
 * Check-list de livraison (RV-35, design §7.6) — coche/décoche appelle directement
 * `POST /dossiers-vente/{id}/documents-requis/marquer`, PAS de dialog (bascule légère, no-op
 * idempotent côté contrat). Particularité de la règle d'erreur (§4, rappelée en §7.6) : un échec
 * s'affiche LOCALEMENT À LA LIGNE (icône + message court), la case revenant visuellement à son état
 * précédent — jamais seulement un toast qui peut passer inaperçu.
 *
 * `documentsRequis` peut être une liste VIDE en pratique (§ tête de fichier de
 * `service-dossier-vente.ts` : « check-list non paramétrée, PV-03 ») — état vide informatif, pas
 * une erreur.
 */
export function CarteDocumentsRequis({ dossierVenteId, documentsRequis, peutModifier }: Props) {
  const { t } = useTranslation(['ventes']);
  const mutation = useMarquerDocumentRequisDossierVente(dossierVenteId);
  const [codeEnCours, setCodeEnCours] = useState<string | null>(null);
  // Message FIXE par ligne (`ventes:dossier.documentsRequis.erreurLigne`), pas `messageErreur` par
  // code : le design (§7.6) veut un repli court à la ligne, pas une seconde surface qui distingue
  // les codes d'erreur possibles (réseau, droit, dossier introuvable...).
  const [erreurParCode, setErreurParCode] = useState<Record<string, boolean>>({});

  function basculer(code: string, fourniActuel: boolean) {
    if (!peutModifier) return;
    setCodeEnCours(code);
    setErreurParCode((precedent) => ({ ...precedent, [code]: false }));
    mutation.mutate(
      { code, fourni: !fourniActuel },
      {
        onSettled: () => setCodeEnCours(null),
        onError: () => setErreurParCode((precedent) => ({ ...precedent, [code]: true })),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('ventes:dossier.documentsRequis.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {documentsRequis.length === 0 ? (
          <EtatVide
            titre={t('ventes:dossier.documentsRequis.titre')}
            description={t('ventes:dossier.documentsRequis.vide')}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {documentsRequis.map((item) => {
              const enErreur = erreurParCode[item.code] === true;
              return (
                <li key={item.code} className="flex flex-col gap-1">
                  <label className="flex min-h-11 items-center gap-3 texte-corps">
                    <Checkbox
                      checked={item.fourni}
                      disabled={!peutModifier || codeEnCours === item.code}
                      onCheckedChange={() => basculer(item.code, item.fourni)}
                    />
                    <span className="flex-1">{item.libelle}</span>
                    {item.fourni && item.fourniLe ? (
                      <span className="texte-libelle text-muted-foreground">
                        {t('ventes:dossier.documentsRequis.fourniLe', {
                          date: formaterDateHeure(item.fourniLe),
                        })}
                      </span>
                    ) : null}
                  </label>
                  {enErreur ? (
                    <p className="pl-9 texte-libelle text-destructive" role="alert">
                      {t('ventes:dossier.documentsRequis.erreurLigne')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
