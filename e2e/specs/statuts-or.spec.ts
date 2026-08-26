import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Statuts d'OR — `composants/identite/BadgeStatutOr.tsx` (`CONFIG_STATUT_OR`, 12 valeurs) : forme
 * + icône + mot, JAMAIS la couleur seule (`composants/identite/BadgeStatut.tsx`, doc de tête —
 * vérification daltonisme explicite). Rendu réel : `<span><Icone aria-hidden />{mot}</span>`.
 *
 * COUVERTURE RÉELLE DES DONNÉES DE DÉMO (mesuré, `dfa_dev`, table `ordre_reparation`,
 * 25.08.2026) : seuls TROIS statuts sur les douze possibles sont peuplés — `ouvert`, `en_cours`,
 * `facture`. Ce fichier le VÉRIFIE plutôt que de le supposer (`verifierCouvertureFiltres`
 * ci-dessous, un statut sans ligne rend l'état vide « filtre », jamais une erreur) et le
 * consigne dans le rapport (pièce jointe `couverture-statuts.json`) au lieu de prétendre à une
 * exhaustivité que les données ne permettent pas — voir le rapport de mission pour le détail.
 */

async function indexColonneEtat(page: Page): Promise<number> {
  const entetes = await page.getByRole('columnheader').allTextContents();
  const index = entetes.findIndex((texte) => texte.trim() === 'État');
  if (index === -1) throw new Error(`Colonne « État » introuvable parmi : ${entetes.join(', ')}`);
  return index;
}

interface BadgeReleve {
  readonly texte: string;
  readonly iconeSvg: string;
}

/** Badge de la colonne État, première ligne de données. `null` si la table est vide (état vide
 *  affiché à la place). */
async function badgePremiereligne(page: Page, indexEtat: number): Promise<BadgeReleve | null> {
  const lignes = page.getByRole('table').getByRole('row');
  // Ligne 0 = en-tête (columnheader) ; les données commencent à l'index 1.
  const premiereDonnee = lignes.nth(1);
  if ((await premiereDonnee.count()) === 0) return null;
  const cellule = premiereDonnee.getByRole('cell').nth(indexEtat);
  if ((await cellule.count()) === 0) return null;

  const svg = cellule.locator('svg').first();
  if ((await svg.count()) === 0) return null;

  return {
    texte: (await cellule.textContent())?.trim() ?? '',
    iconeSvg: (await svg.evaluate((el) => el.outerHTML)) ?? '',
  };
}

function verifieFormeIconeMot(badge: BadgeReleve, etiquette: string): void {
  expect(badge.texte, `${etiquette} — le badge doit porter un mot`).not.toBe('');
  expect(badge.iconeSvg, `${etiquette} — le badge doit porter une icône`).toContain('<svg');
}

test.describe('Statuts d’OR — forme + icône + mot', () => {
  test('les statuts présents dans les données de démo sont visuellement distincts (clair)', async ({
    page,
  }) => {
    await page.goto('/ordres-reparation');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();

    const indexEtat = await indexColonneEtat(page);
    const combobox = page.getByRole('combobox', { name: 'Statut' });
    const options = await ouvrirEtListerOptions(page, combobox);

    const releves = new Map<string, BadgeReleve>();
    const couverture: Record<string, boolean> = {};

    for (const option of options) {
      await combobox.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      await page.waitForResponse((r) => r.url().includes('/api/v1/ordres-reparation'));

      const badge = await badgePremiereligne(page, indexEtat);
      couverture[option] = badge !== null;
      if (badge !== null) {
        verifieFormeIconeMot(badge, option);
        releves.set(option, badge);
      }
    }

    await test.info().attach('couverture-statuts.json', {
      body: JSON.stringify(couverture, null, 2),
      contentType: 'application/json',
    });

    // Diversité réelle : au moins deux statuts distincts avec des données, sans quoi ce test ne
    // prouverait rien. Si ça échoue, c'est un constat sur les données de démo, pas un bug du
    // harnais (voir le commentaire de tête).
    expect(
      releves.size,
      'au moins deux statuts doivent avoir des données en démo',
    ).toBeGreaterThanOrEqual(2);

    // Forme + icône + mot : deux statuts DIFFÉRENTS n'ont jamais la même icône (ni le même mot,
    // par construction de la Map ci-dessus) — la couleur seule ne pourrait pas les distinguer si
    // l'icône était identique.
    const entrees = [...releves.entries()];
    for (let i = 0; i < entrees.length; i += 1) {
      for (let j = i + 1; j < entrees.length; j += 1) {
        expect(
          entrees[i][1].iconeSvg,
          `« ${entrees[i][0]} » et « ${entrees[j][0]} » doivent avoir des icônes différentes`,
        ).not.toBe(entrees[j][1].iconeSvg);
      }
    }
  });

  test('un même statut reste identique (icône + mot) entre clair et sombre — seule la couleur change', async ({
    page,
  }) => {
    await page.goto('/ordres-reparation');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();
    const indexEtat = await indexColonneEtat(page);

    const badgeClair = await badgePremiereligne(page, indexEtat);
    expect(badgeClair, 'la vue par défaut doit contenir au moins un OR en démo').not.toBeNull();
    const couleurClaire = await couleurBadge(page, indexEtat);

    await page.getByRole('button', { name: /passer en thème sombre/i }).click();
    await expect(page.locator('html')).toHaveClass('dark');

    const badgeSombre = await badgePremiereligne(page, indexEtat);
    const couleurSombre = await couleurBadge(page, indexEtat);

    // Mot et icône INCHANGÉS : la distinction ne repose jamais sur la couleur pour être comprise.
    expect(badgeSombre?.texte).toBe(badgeClair?.texte);
    expect(badgeSombre?.iconeSvg).toBe(badgeClair?.iconeSvg);
    // Mais la couleur, elle, doit réellement changer avec le thème (sinon le badge ignorerait le
    // thème plutôt que d'en dépendre).
    expect(couleurSombre).not.toBe(couleurClaire);
  });
});

async function ouvrirEtListerOptions(page: Page, combobox: Locator): Promise<string[]> {
  await combobox.click();
  const textes = await page.getByRole('option').allTextContents();
  // Ferme le menu (Échap) plutôt que de cliquer une option ici — la boucle appelante rouvre et
  // choisit elle-même à chaque itération.
  await page.keyboard.press('Escape');
  return textes.filter((texte) => texte !== 'Tous les statuts');
}

async function couleurBadge(page: Page, indexEtat: number): Promise<string> {
  const cellule = page.getByRole('table').getByRole('row').nth(1).getByRole('cell').nth(indexEtat);
  return cellule
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}
