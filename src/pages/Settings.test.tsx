// @vitest-environment jsdom
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartRecallDB } from '../db/database';
import { AppProvider } from '../contexts/AppProvider';
import Settings from './Settings';

const databases: SmartRecallDB[] = [];
afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await Dexie.delete(database.name);
    }),
  );
});
async function setup() {
  const database = new SmartRecallDB(`settings-ui-${crypto.randomUUID()}`);
  databases.push(database);
  const rendered = render(
    <AppProvider database={database}>
      <Settings />
    </AppProvider>,
  );
  await screen.findByRole('heading', { name: 'Settings' });
  return { database, rendered, user: userEvent.setup() };
}

describe('preferences workflow', () => {
  it('persists limits, time zone, theme and study preferences across reopening', async () => {
    const { database, rendered, user } = await setup();
    await user.clear(screen.getByLabelText('Daily new-card limit'));
    await user.type(screen.getByLabelText('Daily new-card limit'), '7');
    await user.clear(screen.getByLabelText('Daily review limit'));
    await user.type(screen.getByLabelText('Daily review limit'), '30');
    await user.clear(screen.getByLabelText('Study time zone'));
    await user.type(screen.getByLabelText('Study time zone'), 'Asia/Shanghai');
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark');
    await user.click(screen.getByLabelText('Show keyboard shortcut hints'));
    await user.click(screen.getByLabelText('Automatically show answers during study'));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByText('Preferences saved.');
    rendered.unmount();
    database.close();
    await database.open();
    expect(await database.settings.get('app')).toMatchObject({
      dailyNewLimit: 7,
      dailyReviewLimit: 30,
      timeZone: 'Asia/Shanghai',
      theme: 'dark',
      showShortcutHints: false,
      autoShowAnswer: true,
    });
  });
  it('exposes invalid-zone and database-write failures without reporting success', async () => {
    const { database, user } = await setup();
    await user.clear(screen.getByLabelText('Study time zone'));
    await user.type(screen.getByLabelText('Study time zone'), 'Invalid/Zone');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid IANA time zone');
    await user.clear(screen.getByLabelText('Study time zone'));
    await user.type(screen.getByLabelText('Study time zone'), 'UTC');
    const before = await database.settings.get('app');
    database.settings.hook('updating', () => {
      throw new Error('Preferences could not be saved.');
    });
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preferences could not be saved.');
    expect(screen.queryByText('Preferences saved.')).not.toBeInTheDocument();
    expect(await database.settings.get('app')).toEqual(before);
  });
});
