import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

async function waitForOfflineAssets(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (registration.active?.state === 'activated') return;
    await new Promise<void>((resolve) => {
      registration.active?.addEventListener('statechange', () => {
        if (registration.active?.state === 'activated') resolve();
      });
    });
  });
}

test('production manifest names actual locally served icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe('SmartRecall');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]),
  );
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const image = await request.get(`/${icon.src}`);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toBe('image/png');
  }
});

test('production app starts offline after an actual isolated browser restart', async ({
  playwright,
}) => {
  // Windows IndexedDB LevelDB files exceed legacy path limits in deep test-results paths.
  const profileRoot = resolve(process.env.SMARTRECALL_TEST_WORK_DIR || tmpdir(), 'smartrecall-e2e');
  await mkdir(profileRoot, { recursive: true });
  const profile = await mkdtemp(resolve(profileRoot, 'pwa-profile-'));
  if (!profile.startsWith(`${profileRoot}${sep}`))
    throw new Error('Unexpected profile cleanup path');
  const channel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';
  let context = await playwright.chromium.launchPersistentContext(profile, {
    channel,
    headless: true,
  });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4175/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await waitForOfflineAssets(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Decks', exact: true }).click();
    await page.getByRole('button', { name: 'Create deck', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create deck', exact: true });
    await editor.getByLabel('Deck name').fill('Offline study');
    await editor.getByRole('button', { name: 'Save deck', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('navigation').getByRole('link', { name: 'Cards', exact: true }).click();
    await page.getByRole('button', { name: 'Add card', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Add card', exact: true });
    await card.getByLabel('Front', { exact: true }).fill('What stays local?');
    await card.getByLabel('Back', { exact: true }).fill('Cards and review history.');
    await card.getByRole('button', { name: 'Save card', exact: true }).click();
    await expect(card).toHaveCount(0);
    await context.close();

    context = await playwright.chromium.launchPersistentContext(profile, {
      channel,
      headless: true,
      offline: true,
    });
    const reopened = await context.newPage();
    const errors: string[] = [];
    reopened.on('pageerror', (error) => errors.push(error.message));
    await reopened.goto('http://127.0.0.1:4175/');
    await expect(reopened.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(reopened.getByRole('navigation')).toBeVisible();
    await expect(reopened.getByRole('link', { name: 'Offline study', exact: true })).toBeVisible();
    expect(await reopened.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await reopened.goto('http://127.0.0.1:4175/cards');
    await expect(
      reopened.getByRole('heading', { name: 'What stays local?', exact: true }),
    ).toBeVisible();
    await reopened
      .getByRole('navigation')
      .getByRole('link', { name: 'Study', exact: true })
      .click();
    await reopened.getByRole('button', { name: 'Start session', exact: true }).click();
    await reopened.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    await reopened.getByRole('button', { name: /^Good/ }).click();
    await expect(
      reopened.getByRole('heading', { name: 'Session complete', exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText(/1 reviews saved/)).toBeVisible();
    await reopened.reload();
    await expect(reopened.getByText(/1\/20 new introductions today/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('a waiting production service worker needs explicit update acceptance', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await waitForOfflineAssets(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  expect((await request.post('/__test-update')).ok()).toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByRole('button', { name: 'Update and reload' })).toBeVisible();
  expect(
    await page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Update and reload' }).click();
  await expect(page.getByRole('button', { name: 'Update and reload' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(false);
});
