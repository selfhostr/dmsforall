import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SectionEntreprise } from './SectionEntreprise';

/** Libellé d'un champ obligatoire : l'étoile (aria-hidden) fait partie du texte du <label>. */
const avecEtoile = (libelle: string) =>
  new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`);

const CHEMIN = '/api/v1/parametres-entreprise';
const CHEMIN_LOGO = `${CHEMIN}/logo`;
const BASE = { raisonSociale: 'G', numeroTva: null, delaiPaiementJoursDefaut: 30 };

function probleme404() {
  return HttpResponse.json(
    { type: 'about:blank', title: 'x', status: 404, code: 'RESSOURCE_INTROUVABLE', instance: '/x' },
    { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

beforeEach(() => {
  URL.createObjectURL = () => 'blob:apercu';
  URL.revokeObjectURL = () => {};
  server.use(http.get(CHEMIN_LOGO, () => probleme404()));
});

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <SectionEntreprise />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SectionEntreprise', () => {
  it('affiche la raison sociale modifiable et le n° TVA actuel', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({
          raisonSociale: 'Garage Martin SA',
          numeroTva: 'CHE-116.281.710 TVA',
          delaiPaiementJoursDefaut: 30,
        }),
      ),
    );
    rendre();
    const raison = await screen.findByLabelText(
      avecEtoile(i18n.t('parametrage:entreprise.raisonSociale')),
    );
    expect(raison).toHaveValue('Garage Martin SA');
    expect(raison).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText(i18n.t('parametrage:entreprise.numeroTva'))).toHaveValue(
      'CHE-116.281.710 TVA',
    );
  });

  it('refuse un numéro mal formé AVANT tout appel API, sans perdre la saisie', async () => {
    let appels = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, () => {
        appels += 1;
        return HttpResponse.json(BASE);
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.type(champ, 'CHE-123');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:entreprise.erreurTva.format'),
    );
    expect(champ).toHaveValue('CHE-123');
    expect(appels).toBe(0);
  });

  it('numéro valide : PATCH avec le numéro normalisé, puis confirmation', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...BASE, numeroTva: 'CHE-116.281.710 TVA' });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.type(champ, 'che-116.281.710 tva');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corps).toEqual({
      raisonSociale: 'G',
      numeroTva: 'CHE-116.281.710 TVA',
      delaiPaiementJoursDefaut: 30,
    });
  });

  it('champ vidé : envoie null (efface le numéro)', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ ...BASE, numeroTva: 'CHE-116.281.710 TVA' })),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(BASE);
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.clear(champ);
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    await waitFor(() =>
      expect(corps).toEqual({ raisonSociale: 'G', numeroTva: null, delaiPaiementJoursDefaut: 30 }),
    );
  });

  it('raison sociale modifiée : PATCH avec la valeur nettoyée, confirmation affichée', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...BASE, raisonSociale: 'Garage Martin Sàrl' });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(
      avecEtoile(i18n.t('parametrage:entreprise.raisonSociale')),
    );
    await userEvent.clear(champ);
    await userEvent.type(champ, '  Garage Martin Sàrl ');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corps).toEqual({
      raisonSociale: 'Garage Martin Sàrl',
      numeroTva: null,
      delaiPaiementJoursDefaut: 30,
    });
    expect(champ).toHaveValue('Garage Martin Sàrl');
  });

  it('raison sociale vidée : refus local sans appel API', async () => {
    let appels = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, () => {
        appels += 1;
        return HttpResponse.json(BASE);
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(
      avecEtoile(i18n.t('parametrage:entreprise.raisonSociale')),
    );
    await userEvent.clear(champ);
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:entreprise.erreurRaison'),
    );
    expect(appels).toBe(0);
  });

  it('erreur de chargement : message actionnable avec Réessayer', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'x', status: 500, code: 'ERREUR_INTERNE', instance: '/x' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.erreur.titre')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });

  it('délai de paiement : PATCH avec la valeur saisie (entier de 0 à 365)', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...BASE, delaiPaiementJoursDefaut: 45 });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.delaiPaiement'));
    expect(champ).toHaveValue(30);
    await userEvent.clear(champ);
    await userEvent.type(champ, '45');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    await waitFor(() =>
      expect(corps).toEqual({ raisonSociale: 'G', numeroTva: null, delaiPaiementJoursDefaut: 45 }),
    );
  });

  it('délai hors bornes : refusé avant tout appel, saisie conservée', async () => {
    let appels = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, () => {
        appels += 1;
        return HttpResponse.json(BASE);
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.delaiPaiement'));
    await userEvent.clear(champ);
    await userEvent.type(champ, '400');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:entreprise.erreurDelai'),
    );
    expect(champ).toHaveValue(400);
    expect(appels).toBe(0);
  });

  it('logo : envoi multipart (champ « logo »), aperçu, puis note SVG non imprimé', async () => {
    let champs: FormData | undefined;
    let depose = false;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.get(CHEMIN_LOGO, () =>
        depose
          ? new HttpResponse('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
          : probleme404(),
      ),
      http.put(CHEMIN_LOGO, async ({ request }) => {
        champs = await request.formData();
        depose = true;
        return HttpResponse.json({ typeMime: 'image/svg+xml', tailleOctets: 6 });
      }),
    );
    rendre();
    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.logo.aucun')),
    ).toBeInTheDocument();
    const fichier = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await userEvent.upload(
      screen.getByLabelText(i18n.t('parametrage:entreprise.logo.choisir'), { selector: 'input' }),
      fichier,
    );

    expect(
      await screen.findByAltText(i18n.t('parametrage:entreprise.logo.alt')),
    ).toBeInTheDocument();
    expect((champs?.get('logo') as Blob).size).toBe(6);
    expect(
      screen.getByText(i18n.t('parametrage:entreprise.logo.svgNonImprime')),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.logo.supprimer') }),
    ).toBeInTheDocument();
  });

  it('logo trop lourd ou de mauvais type : refusé avant tout envoi', async () => {
    let envois = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.put(CHEMIN_LOGO, () => {
        envois += 1;
        return HttpResponse.json({});
      }),
    );
    rendre();
    await screen.findByText(i18n.t('parametrage:entreprise.logo.aucun'));
    const entree = screen.getByLabelText(i18n.t('parametrage:entreprise.logo.choisir'), {
      selector: 'input',
    });
    const lourd = new File([new Uint8Array(1_048_577)], 'gros.png', { type: 'image/png' });
    await userEvent.upload(entree, lourd);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:entreprise.logo.refus.taille'),
    );
    expect(envois).toBe(0);
  });

  it('logo : « Supprimer » appelle DELETE et revient à « aucun logo »', async () => {
    let supprime = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.get(
        CHEMIN_LOGO,
        () => new HttpResponse('x', { headers: { 'Content-Type': 'image/png' } }),
      ),
      http.delete(CHEMIN_LOGO, () => {
        supprime += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    rendre();
    await userEvent.click(
      await screen.findByRole('button', { name: i18n.t('parametrage:entreprise.logo.supprimer') }),
    );
    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.logo.aucun')),
    ).toBeInTheDocument();
    expect(supprime).toBe(1);
  });
});
