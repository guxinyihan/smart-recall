import { useEffect, useState } from 'react';

export function useClock(period = 15000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), period);
    const refresh = () => setNow(Date.now());
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [period]);
  return now;
}
