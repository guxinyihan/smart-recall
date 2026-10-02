import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BackupData } from '../src/domain/importExport/validation';

const screenshots = process.env.UPDATE_SCREENSHOTS === '1';

async function navigate(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function createDeck(page: Page, name: string, description: string) {
  await page.getByRole('button', { name: 'Create deck', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create deck', exact: true });
  await dialog.getByLabel('Deck name').fill(name);
  await dialog.getByLabel('Description').fill(description);
  await dialog.getByRole('button', { name: 'Save deck', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function createCard(
  page: Page,
  input: { deck: string; type: string; front?: string; back?: string; text?: string; tags: string },
) {
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card', exact: true });
  await dialog
    .getByRole('combobox', { name: 'Deck', exact: true })
    .selectOption({ label: input.deck });
  await dialog.getByRole('combobox', { name: 'Card type', exact: true }).selectOption(input.type);
  if (input.type === 'cloze')
    await dialog.getByLabel('Cloze text', { exact: true }).fill(input.text!);
  else {
    await dialog.getByLabel('Front', { exact: true }).fill(input.front!);
    await dialog.getByLabel('Back', { exact: true }).fill(input.back!);
  }
  await dialog.getByLabel('Tags (comma separated)', { exact: true }).fill(input.tags);
  await assertResponsive(page);
  await dialog.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function screenshot(page: Page, name: string) {
  if (!screenshots) return;
  await mkdir(resolve('screenshots'), { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: resolve('screenshots', `smartrecall-${name}.png`),
    fullPage: true,
  });
}

async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function assertResponsive(page: Page) {
  const original = page.viewportSize();
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await assertNoOverflow(page);
  }
  if (original) await page.setViewportSize(original);
}

async function exportJson(page: Page): Promise<{ text: string; backup: BackupData }> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON backup', exact: true }).click();
  const saved = await download;
  const path = await saved.path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, 'utf8');
  return { text, backup: JSON.parse(text) as BackupData };
}

test('complete study, backup, import, accessibility and responsive acceptance workflow', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date('2026-10-02T02:00:00Z'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await navigate(page, 'Settings');
  await page.getByLabel('Daily new-card limit', { exact: true }).fill('4');
  await page.getByLabel('Study time zone', { exact: true }).fill('Asia/Shanghai');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Preferences saved.');

  await navigate(page, 'Decks');
  const trigger = page.getByRole('button', { name: 'Create deck', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create deck', exact: true });
  await expect(dialog.getByLabel('Deck name')).toBeFocused();
  await dialog.getByRole('button', { name: 'Save deck', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Close Create deck', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save deck', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await createDeck(
    page,
    'Operating Systems',
    'Processes, concurrency and the foundations of a computer.',
  );
  await navigate(page, 'Cards');
  await createCard(page, {
    deck: 'Operating Systems',
    type: 'basic',
    front: 'What does fork() do?',
    back: 'Creates a new process.',
    tags: 'OS, fork, week-5',
  });
  await createCard(page, {
    deck: 'Operating Systems',
    type: 'reverse',
    front: 'process',
    back: '进程',
    tags: 'os, vocabulary',
  });
  await createCard(page, {
    deck: 'Operating Systems',
    type: 'cloze',
    text: 'A semaphore is commonly used for {{c1::process synchronization}}.',
    tags: 'OS, synchronization',
  });
  await expect(page.getByText('3 notes found', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tag filter', exact: true }).selectOption('fork');
  await expect(page.getByText('1 notes found', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What does fork() do?', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Tag filter', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: 'Type filter', exact: true }).selectOption('reverse');
  await expect(page.getByText('1 notes found', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Type filter', exact: true }).selectOption('');

  await navigate(page, 'Study');
  await page
    .getByRole('combobox', { name: 'Study deck', exact: true })
    .selectOption({ label: 'Operating Systems' });
  await expect(
    page.getByRole('heading', { name: '4 study units ready', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  for (let index = 0; index < 4; index += 1) {
    await expect(page.getByRole('button', { name: 'Reveal answer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Again/ })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /^Again/ })).toBeVisible();
    if (index === 0) {
      await page.keyboard.press('Space');
      await expect(
        page.getByRole('progressbar', { name: 'Session progress', exact: true }),
      ).toHaveAttribute('value', '0');
      await assertResponsive(page);
      await screenshot(page, 'study');
    }
    if (index === 0) await page.getByRole('button', { name: /^Again/ }).click();
    else if (index === 2) await page.getByRole('button', { name: /^Good/ }).click();
    else await page.keyboard.press(String(index + 1));
  }
  await expect(page.getByRole('heading', { name: 'Session complete', exact: true })).toBeVisible();
  await expect(page.getByText(/4 reviews saved/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('4/4 new introductions today · 0/100 existing units today', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'You are caught up for now', exact: true }),
  ).toBeVisible();

  await navigate(page, 'Decks');
  await createDeck(
    page,
    'Computer Networks',
    'Protocols, reliability and communication between computers.',
  );
  await navigate(page, 'Cards');
  await createCard(page, {
    deck: 'Computer Networks',
    type: 'basic',
    front: 'What does TCP provide?',
    back: 'Reliable, ordered byte streams.',
    tags: 'networks, tcp',
  });
  await page
    .getByRole('combobox', { name: 'Deck filter', exact: true })
    .selectOption({ label: 'Operating Systems' });
  await expect(page.getByText('3 notes found', { exact: true })).toBeVisible();
  await navigate(page, 'Study');
  await expect(
    page.getByRole('heading', { name: 'Your daily limits are reached', exact: true }),
  ).toBeVisible();

  await navigate(page, 'Analytics');
  await expect(page.getByText('75.0%', { exact: false })).toBeVisible();
  await assertResponsive(page);
  await screenshot(page, 'analytics');
  await navigate(page, 'Dashboard');
  await screenshot(page, 'dashboard');
  await assertNoOverflow(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await assertNoOverflow(page);
  await screenshot(page, 'tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await screenshot(page, 'mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, 'Decks');
  await page.getByRole('link', { name: 'Operating Systems', exact: true }).click();
  await assertResponsive(page);
  await screenshot(page, 'deck');
  await expect(page.getByRole('button', { name: 'Delete empty deck', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Deck archived.');
  await expect(page.getByRole('button', { name: 'Unarchive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Deck restored.');

  await navigate(page, 'Import / Export');
  const { text: backupText, backup } = await exportJson(page);
  expect(backup.format).toBe('smart-recall-backup');
  expect(backup.decks).toHaveLength(2);
  expect(backup.cards).toHaveLength(4);
  expect(backup.units).toHaveLength(5);
  expect(backup.events).toHaveLength(4);
  expect(backup.events.map((event) => event.rating).sort()).toEqual([
    'again',
    'easy',
    'good',
    'hard',
  ]);
  expect(backup.events.every((event) => event.introduced)).toBe(true);
  expect(
    backup.cards.every((card) => card.tags.every((tag) => tag === tag.trim().toLowerCase())),
  ).toBe(true);
  expect(backup.settings.dailyNewLimit).toBe(4);

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV cards', exact: true }).click();
  const csvPath = await (await csvDownload).path();
  const csv = await readFile(csvPath!, 'utf8');
  expect(csv).toContain('"deck","type","front","back","text","tags"');
  expect(csv).toContain('Operating Systems');
  expect(csv).toContain('process synchronization');
  await page.getByRole('combobox', { name: 'Import format', exact: true }).selectOption('csv');
  await page.getByRole('textbox', { name: 'Import contents', exact: true }).fill(csv);
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await assertResponsive(page);
  await expect(page.getByText('0 cards to create.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import cards', exact: true })).toBeDisabled();

  await page.getByRole('combobox', { name: 'Import format', exact: true }).selectOption('notes');
  await page
    .getByRole('combobox', { name: 'Destination deck', exact: true })
    .selectOption({ label: 'Computer Networks' });
  await page
    .getByRole('textbox', { name: 'Import contents', exact: true })
    .fill('IPC ? Inter-Process Communication\nIPC ? Inter-Process Communication\ninvalid row');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(
    page.getByText('1 cards to create. Invalid rows will be skipped.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import cards', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Confirm card import', exact: true });
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(importDialog).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Imported 1 cards. Skipped 1 duplicates and 1 invalid rows.',
  );
  await page.reload();
  const updated = await exportJson(page);
  expect(updated.backup.cards).toHaveLength(5);
  expect(updated.backup.events).toHaveLength(4);
  expect(updated.backup.units.find((unit) => unit.lastReviewedAt !== null)?.due).toEqual(
    expect.any(Number),
  );

  const restoredContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: 'http://127.0.0.1:4175',
  });
  try {
    const restored = await restoredContext.newPage();
    await restored.goto('/import');
    await expect(
      restored.getByRole('heading', { name: 'Import / Export', exact: true }),
    ).toBeVisible();
    await restored
      .getByRole('combobox', { name: 'Import format', exact: true })
      .selectOption('backup');
    await restored.getByRole('textbox', { name: 'Import contents', exact: true }).fill(backupText);
    await restored.getByRole('button', { name: 'Preview import', exact: true }).click();
    await restored.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await restored
      .getByRole('dialog', { name: 'Confirm backup restore', exact: true })
      .getByRole('button', { name: 'Confirm restore', exact: true })
      .click();
    await expect(restored.getByRole('main').getByRole('status')).toContainText(
      'Backup restored. Existing cards and reviews were preserved.',
    );
    const roundtrip = await exportJson(restored);
    expect(roundtrip.backup.cards).toEqual(backup.cards);
    expect(roundtrip.backup.units).toEqual(backup.units);
    expect(roundtrip.backup.events).toEqual(backup.events);
    expect(roundtrip.backup.settings.dailyNewLimit).toBe(4);
  } finally {
    await restoredContext.close();
  }
  expect(errors).toEqual([]);
});

test('real browser v1 migration preserves legacy content and can study it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T02:00:00Z'));
  await page.route('**/assets/index-*.js', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('flashcardDB', 10); // Dexie v1 native database version.
      request.onupgradeneeded = () => {
        const words = request.result.createObjectStore('words', {
          keyPath: 'id',
          autoIncrement: true,
        });
        for (const field of ['word', 'box', 'nextReview']) words.createIndex(field, field);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('words', 'readwrite');
        transaction.objectStore('words').add({
          id: 'legacy-fork',
          word: 'fork()',
          context: 'Creates a new process.',
          box: 1,
          nextReview: '2026-10-01',
          lastReviewed: '1970-01-01',
        });
        transaction.objectStore('words').add({
          id: 7,
          word: 'semaphore',
          context: 'Synchronizes concurrent processes.',
          box: 3,
          nextReview: '2026-10-01',
          lastReviewed: '2026-09-28',
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
    });
  });
  await page.unroute('**/assets/index-*.js');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await navigate(page, 'Cards');
  await expect(page.getByText('2 notes found', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'fork()', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'semaphore', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('2 notes found', { exact: true })).toBeVisible();
  await navigate(page, 'Import / Export');
  const { backup } = await exportJson(page);
  expect(
    backup.cards.map((card) => card.id).sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual([7, 'legacy-fork']);
  expect(backup.decks[0].name).toBe('Imported Vocabulary');
  expect(backup.legacyWords).toHaveLength(2);
  expect(backup.events).toHaveLength(0);
  expect(backup.units.find((unit) => unit.cardId === 7)?.interval).toBe(4);
  await navigate(page, 'Study');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Session progress', exact: true }),
  ).toHaveAttribute('value', '1');
  await navigate(page, 'Import / Export');
  expect((await exportJson(page)).backup.events).toHaveLength(1);
});
