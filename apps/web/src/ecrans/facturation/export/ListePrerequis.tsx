import type { TFunction } from 'i18next';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LimiteExport, PrerequisExport } from '@dfa/shared';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formaterMontant } from '@/lib/formats';

import { nomCodeTva, nomPosteCompte } from './postes';

interface Props {
  readonly prerequis: readonly PrerequisExport[];
  /** Ouvre la saisie des comptes ; absent si l'utilisateur ne peut pas les régler. */
  readonly onReglerComptes?: () => void;
}

/** Ce qui empêche l'export, en clair, avec le détail (comptes, numéros, écritures). Sert à
 *  l'aperçu ET au refus 409 : les deux portent les mêmes éléments. */
export function ListePrerequis({ prerequis, onReglerComptes }: Props) {
  const { t } = useTranslation(['export']);

  return (
    <div className="space-y-3">
      {prerequis.map((p) => (
        <Alert key={p.code} variant="avertissement" role="alert">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
            {t(`export:prerequis.${p.code}.titre`)}
          </p>
          <p>{t(`export:prerequis.${p.code}.description`)}</p>

          {p.code === 'EXPORT_MAPPING_INCOMPLET' ? (
            <>
              <ul className="mt-2 list-disc pl-5">
                {p.comptes.map((c) => (
                  <li key={`${c.usage}:${c.categorie}`}>
                    {nomPosteCompte(t, c.usage, c.categorie)}
                    <Pieces references={c.references} />
                  </li>
                ))}
                {p.codesTva.map((c) => (
                  <li key={`${c.regimeTva}:${String(c.tauxPourmille)}`}>
                    {t('export:prerequis.codeTva', {
                      poste: nomCodeTva(t, c.regimeTva, c.tauxPourmille),
                    })}
                    <Pieces references={c.references} />
                  </li>
                ))}
              </ul>
              {onReglerComptes ? (
                <Button type="button" variant="outline" className="mt-3" onClick={onReglerComptes}>
                  {t('export:mapping.regler')}
                </Button>
              ) : null}
            </>
          ) : null}

          {p.code === 'EXPORT_TROU_NUMEROTATION' ? (
            <ul className="mt-2 list-disc pl-5">
              {p.trous.map((trou) => (
                <li key={`${trou.typeDocument}:${String(trou.exercice)}`}>
                  {t('export:prerequis.trou', {
                    type: t(`export:prerequis.typeDocument.${trou.typeDocument}`),
                    exercice: trou.exercice,
                    numeros: trou.numeros.join(', '),
                  })}
                </li>
              ))}
            </ul>
          ) : null}

          {p.code === 'EXPORT_ECRITURES_DESEQUILIBREES' ? (
            <ul className="mt-2 list-disc pl-5">
              {p.ecritures.map((e) => (
                <li key={e.reference}>
                  {t('export:prerequis.desequilibre', {
                    reference: e.reference,
                    debit: formaterMontant(e.totalDebitCentimes),
                    credit: formaterMontant(e.totalCreditCentimes),
                  })}
                </li>
              ))}
            </ul>
          ) : null}

          {p.code === 'FONCTION_NON_DISPONIBLE' ? (
            <ul className="mt-2 list-disc pl-5">
              {p.details.length > 0
                ? p.details.map((detail, index) => (
                    <li key={`${detail.code}-${String(index)}`}>{texteLimite(detail, t)}</li>
                  ))
                : p.limites.map((l) => <li key={l}>{l}</li>)}
            </ul>
          ) : null}
        </Alert>
      ))}
    </div>
  );
}

function Pieces({ references }: { references: readonly string[] }) {
  const { t } = useTranslation(['export']);
  if (references.length === 0) return null;
  return (
    <span className="text-muted-foreground">
      {' '}
      {t('export:prerequis.pieces', { pieces: references.join(', ') })}
    </span>
  );
}

/** Un identifiant technique (uuid) ne dit rien au garagiste : on ne l'affiche pas. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function referenceLisible(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur !== '' && !UUID.test(valeur) ? valeur : undefined;
}

/** La limite de l'export en phrase du garagiste, depuis son code stable et ses données. */
function texteLimite(detail: LimiteExport, t: TFunction<'export'>): string {
  const reference = referenceLisible(detail.donnees.documentId);
  const sur = reference ? ` ${t('export:prerequis.limite.sur', { reference })}` : '';
  switch (detail.code) {
    case 'ADAPTATEUR_NON_CABLE':
      return t('export:prerequis.limite.ADAPTATEUR_NON_CABLE', {
        cible: t(`export:format.${String(detail.donnees.cible)}.nom`, {
          defaultValue: String(detail.donnees.cible ?? ''),
        }),
      });
    case 'COMPENSATION_NON_SUPPORTEE':
      return `${t('export:prerequis.limite.COMPENSATION_NON_SUPPORTEE')}${sur}`;
    case 'TAUX_MULTIPLES_NON_SUPPORTE':
      return `${t('export:prerequis.limite.TAUX_MULTIPLES_NON_SUPPORTE', {
        nature: detail.donnees.nature === 'perte' ? 'perte' : 'escompte',
      })}${sur}`;
  }
}
