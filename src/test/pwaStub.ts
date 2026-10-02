// Component tests replace this hook; the production bundle uses the PWA plugin.
export function useRegisterSW() {
  return { offlineReady: [false, () => {}], needRefresh: [false, () => {}], updateServiceWorker: async () => {} };
}
