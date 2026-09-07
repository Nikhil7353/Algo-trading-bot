import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

// Context and hook are co-located intentionally (small module, not a component file).
// The fast-refresh warning is a false positive — this file exports no React components.
const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  const [portfolio, setPortfolio] = useState(null);
  // error is only set on the very first failed load; background failures are silent
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api.portfolio();
      setPortfolio(data);
      setError('');
    } catch (err) {
      // Only surface the error if we have nothing to show yet
      if (!portfolio) {
        const status = err?.status;
        if (status === 401) {
          setError('Invalid API key (401). Check STOCKBOT_API_KEY and restart the server.');
        } else if (status === 503) {
          setError('Server not ready (503). Wait a moment and refresh.');
        } else {
          setError('Portfolio data unavailable. Confirm the API server is running on port 8000.');
        }
      }
      // Background refresh failure → keep stale data, no banner
    }
  }, [portfolio]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <PortfolioContext.Provider value={{ portfolio, error, refresh }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
