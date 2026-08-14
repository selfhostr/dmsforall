import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ROLES_CONTACT, type RoleContact } from '@dfa/shared';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { useContactsClient, useCreerContactClient } from '@/hooks/clients/useContactsClient';

import { cleRoleContact, texteOuVide } from '../utils';
import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/** Onglet « Contacts » (RM-04) — rôles CUMULABLES sur un même contact. */
export function OngletContacts({ clientId }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const requete = useContactsClient(clientId);
  const creerContact = useCreerContactClient(clientId);

  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<RoleContact[]>([]);

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  const reinitialiser = () => {
    setNom('');
    setPrenom('');
    setTelephone('');
    setEmail('');
    setRoles([]);
  };

  const basculerRole = (role: RoleContact, coche: boolean) => {
    setRoles((precedent) => (coche ? [...precedent, role] : precedent.filter((r) => r !== role)));
  };

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    if (!nom.trim() || roles.length === 0) return;
    creerContact.mutate(
      {
        nom: nom.trim(),
        prenom: prenom.trim() || undefined,
        telephone: telephone.trim() || undefined,
        email: email.trim() || undefined,
        roles,
      },
      {
        onSuccess: () => {
          setOuvert(false);
          reinitialiser();
        },
      },
    );
  };

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    // Efface l'erreur ET LES VALEURS d'une tentative précédente : sans `reinitialiser()`, rouvrir
    // le dialogue pour une NOUVELLE saisie laisse les anciennes valeurs en place (le dialogue
    // n'est pas garanti démonté entre deux ouvertures). Même défaut, même correctif que
    // `FormulaireNouveauClient` (défaut 1, corruption de saisie constatée en base).
    if (valeur) {
      creerContact.reset();
      reinitialiser();
    }
  };

  const erreurServeur = creerContact.error instanceof ErreurApi ? creerContact.error : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="texte-titre-section font-medium text-foreground">
          {t('clients:contacts.titre')}
        </h3>
        <Dialog open={ouvert} onOpenChange={changerOuvert}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {t('clients:contacts.ajouter')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('clients:contacts.ajouter')}</DialogTitle>
            </DialogHeader>
            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>
            <form onSubmit={soumettre} noValidate className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="contact-nom" requis>
                  {t('clients:identite.nom')}
                </Label>
                <Input
                  id="contact-nom"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  aria-invalid={erreurServeur?.champErreur('nom') ? true : undefined}
                  required
                />
                {erreurServeur?.champErreur('nom') ? (
                  <p className="text-sm text-destructive">
                    {messageErreurChamp(erreurServeur.champErreur('nom')!, t)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-prenom">{t('clients:identite.prenom')}</Label>
                <Input
                  id="contact-prenom"
                  value={prenom}
                  onChange={(e) => setPrenom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-telephone">{t('clients:identite.telephone')}</Label>
                <Input
                  id="contact-telephone"
                  type="tel"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  aria-invalid={erreurServeur?.champErreur('telephone') ? true : undefined}
                />
                {erreurServeur?.champErreur('telephone') ? (
                  <p className="text-sm text-destructive">
                    {messageErreurChamp(erreurServeur.champErreur('telephone')!, t)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email">{t('clients:identite.email')}</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={erreurServeur?.champErreur('email') ? true : undefined}
                />
                {/* Défaut 3 : un e-mail refusé par le serveur (`schemaContactClient.email`, non
                    validé côté front dans cet onglet) mourait dans le seul bandeau générique
                    ci-dessous. `messageErreurChamp` reconnaît ce cas (code natif zod sur un champ
                    `email`) et retombe sur la clé i18n existante plutôt que le message anglais
                    brut de zod. */}
                {erreurServeur?.champErreur('email') ? (
                  <p className="text-sm text-destructive">
                    {messageErreurChamp(erreurServeur.champErreur('email')!, t)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label id="contact-roles-label" requis>
                  {t('clients:contacts.champs.roles')}
                </Label>
                {/* Groupe de cases à cocher « au moins un rôle » (`schemaContactClient.roles`,
                    `.min(1)`) : aucune case Radix `Checkbox` prise isolément ne peut porter
                    `aria-required` (la contrainte porte sur l'ENSEMBLE, pas sur une case précise)
                    — posé ici, sur le groupe, avec `aria-labelledby` vers le libellé étoilé
                    ci-dessus, exactement le même patron que le sélecteur de type de client
                    (`FormulaireNouveauClient.tsx`, groupe de boutons). */}
                <div
                  role="group"
                  aria-required="true"
                  aria-labelledby="contact-roles-label"
                  className="flex flex-wrap gap-x-4 gap-y-2"
                >
                  {ROLES_CONTACT.map((role) => (
                    <label
                      key={role}
                      htmlFor={`contact-role-${role}`}
                      className="flex items-center gap-2 texte-corps"
                    >
                      <Checkbox
                        id={`contact-role-${role}`}
                        checked={roles.includes(role)}
                        onCheckedChange={(v) => basculerRole(role, v === true)}
                      />
                      {t(`clients:contacts.roles.${cleRoleContact(role)}`)}
                    </label>
                  ))}
                </div>
              </div>
              {creerContact.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(creerContact.error, t)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={creerContact.isPending || !nom.trim() || roles.length === 0}
                >
                  {t('commun:actions.ajouter')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <EtatSousCollection
        enChargement={requete.isLoading}
        erreur={requete.error}
        onReessayer={() => void requete.refetch()}
        vide={lignes.length === 0}
        texteVide={t('clients:contacts.vide')}
      >
        <ul className="space-y-2">
          {lignes.map((contact) => (
            <li key={contact.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="texte-corps font-medium text-foreground">
                  {contact.nom}
                  {contact.prenom ? ` ${contact.prenom}` : ''}
                </span>
                <div className="flex flex-wrap gap-1">
                  {contact.roles.map((role) => (
                    <span
                      key={role}
                      className="texte-libelle rounded-full border px-2 py-0.5 text-muted-foreground"
                    >
                      {t(`clients:contacts.roles.${cleRoleContact(role)}`)}
                    </span>
                  ))}
                </div>
              </div>
              <p className="texte-libelle text-muted-foreground">
                {texteOuVide(
                  [contact.telephone, contact.email].filter(Boolean).join(' · ') || null,
                )}
              </p>
            </li>
          ))}
        </ul>
      </EtatSousCollection>
    </div>
  );
}
