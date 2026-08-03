import type { ResultatRecherche, TypeDocumentVente } from '@dfa/shared';
import { TYPES_DOCUMENT_VENTE } from '@dfa/shared';

import { BadgeTypeDocument } from '@/ecrans/facturation/BadgeTypeDocument';

import { texteResume } from './resume';

export interface ProprietesResultatDocumentVente {
  readonly resultat: ResultatRecherche;
}

function estTypeDocumentVente(valeur: string | null): valeur is TypeDocumentVente {
  return valeur !== null && (TYPES_DOCUMENT_VENTE as readonly string[]).includes(valeur);
}

/**
 * Contenu d'une ligne de résultat « document de vente ». Enveloppé dans un `CommandItem` par
 * `PanneauResultatsRecherche` — même patron que `ResultatClient`/`ResultatOr` : ce composant ne
 * rend que le contenu de la ligne.
 *
 * Un `document_vente` couvre quatre natures (devis, bon de commande, facture, avoir) —
 * `BadgeTypeDocument` (déjà utilisé par la fiche facture, `ecrans/facturation/`) est réutilisé
 * tel quel plutôt que de réinventer un second vocabulaire visuel pour la même distinction.
 *
 * RF-116 : le `resume` serveur ne porte JAMAIS de clé monétaire pour ce type (visibilité des
 * montants dépendante du rôle, tranchée à la source) — aucun montant n'est donc affiché ni
 * dérivé ici, à l'identique des trois types existants.
 */
export function ResultatDocumentVente({ resultat }: ProprietesResultatDocumentVente) {
  const numero = texteResume(resultat.resume.numero) ?? '';
  const type = texteResume(resultat.resume.typeDocument);
  const clientNom = texteResume(resultat.resume.clientNom);
  const dateDocument = texteResume(resultat.resume.dateDocument);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{numero}</span>
      {estTypeDocumentVente(type) ? <BadgeTypeDocument type={type} /> : null}
      {clientNom ? <span className="texte-libelle text-muted-foreground">{clientNom}</span> : null}
      {dateDocument ? (
        <span className="texte-libelle text-muted-foreground">{dateDocument}</span>
      ) : null}
    </div>
  );
}
