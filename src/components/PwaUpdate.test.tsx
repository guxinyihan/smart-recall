// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import PwaUpdate from './PwaUpdate';

const registration = vi.hoisted(() => ({
  refresh: false,
  ready: false,
  options: undefined as RegisterSWOptions | undefined,
  update: vi.fn<() => Promise<void>>(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW(options: RegisterSWOptions) {
    registration.options = options;
    return {
      needRefresh: [registration.refresh, vi.fn()],
      offlineReady: [registration.ready, vi.fn()],
      updateServiceWorker: registration.update,
    };
  },
}));

afterEach(() => {
  cleanup();
  registration.refresh = false;
  registration.ready = false;
  registration.update.mockReset();
  vi.restoreAllMocks();
});

describe('PWA update feedback', () => {
  it('does not promise offline availability before caching finishes', () => {
    render(<PwaUpdate />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('announces completed offline caching', () => {
    registration.ready = true;
    render(<PwaUpdate />);
    expect(screen.getByRole('status').textContent).toContain('cached for offline use');
  });

  it('waits for explicit action before activating an update', async () => {
    registration.refresh = true;
    registration.update.mockResolvedValue();
    render(<PwaUpdate />);
    expect(registration.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Update and reload' }));
    await waitFor(() => expect(registration.update).toHaveBeenCalledOnce());
  });

  it('shows a recoverable error if update activation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registration.refresh = true;
    registration.update.mockRejectedValue(new Error('Simulated offline update'));
    render(<PwaUpdate />);
    fireEvent.click(screen.getByRole('button', { name: 'Update and reload' }));
    expect((await screen.findByRole('alert')).textContent).toContain('saved study data');
    expect(screen.getByRole('button', { name: 'Update and reload' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('explains registration failure without exposing developer diagnostics', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<PwaUpdate />);
    act(() => registration.options?.onRegisterError?.(new Error('Internal worker detail')));
    expect(screen.getByRole('alert').textContent).toContain('Offline setup could not finish');
    expect(screen.queryByText('Internal worker detail')).toBeNull();
  });
});
