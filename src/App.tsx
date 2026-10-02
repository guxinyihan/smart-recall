import { Component, useEffect, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from './contexts/AppProvider';
import { useApp } from './contexts/appContext';
import Dashboard from './pages/Dashboard';
import Decks from './pages/Decks';
import Cards from './pages/Cards';
import Study from './pages/Study';
import Analytics from './pages/Analytics';
import ImportExport from './pages/ImportExport';
import Settings from './pages/Settings';
import PwaUpdate from './components/PwaUpdate';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('SmartRecall rendering failed', error);
  }
  render() {
    return this.state.failed ? (
      <main className="startup">
        <h1>SmartRecall could not display this page</h1>
        <p role="alert">Your saved data has not been cleared. Reload to try again.</p>
        <button onClick={() => window.location.reload()}>Reload application</button>
      </main>
    ) : (
      this.props.children
    );
  }
}

function Shell() {
  const { data } = useApp();
  const location = useLocation();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        data.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : data.settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data.settings.theme]);
  useEffect(() => {
    document.getElementById('main-content')?.focus();
  }, [location.pathname]);
  const navigation = [
    ['/', 'Dashboard'],
    ['/decks', 'Decks'],
    ['/study', 'Study'],
    ['/cards', 'Cards'],
    ['/analytics', 'Analytics'],
    ['/import', 'Import / Export'],
    ['/settings', 'Settings'],
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SmartRecall
        </NavLink>
        <p className="brand-caption">Your study workspace</p>
        <nav aria-label="Main navigation">
          {navigation.map(([path, label]) => (
            <NavLink key={path} to={path} end={path === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="sidebar-foot">
          Study anywhere.
          <br />
          Keep your data local.
        </p>
      </aside>
      <div className="workspace">
        <div className="workspace-bar">
          <span>Personal collection</span>
          <span>Stored on this device</span>
        </div>
        <main id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/decks" element={<Decks />} />
            <Route path="/decks/:deckId" element={<Decks />} />
            <Route path="/cards" element={<Cards />} />
            <Route path="/study" element={<Study />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/import" element={<ImportExport />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/learn" element={<Navigate to="/study" replace />} />
            <Route path="/words" element={<Navigate to="/cards" replace />} />
            <Route path="/database" element={<Navigate to="/import" replace />} />
            <Route path="/help" element={<Navigate to="/settings" replace />} />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <NavLink to="/">Back to dashboard</NavLink>
                </>
              }
            />
          </Routes>
        </main>
        <PwaUpdate />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
