import { useEffect, useState } from 'preact/hooks';

export function currentPath(): string[] {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [p, setP] = useState(currentPath());
  useEffect(() => {
    const f = () => { setP(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return p;
}

export const go = (path: string) => { location.hash = '#/' + path.replace(/^\//, ''); };
export const href = (path: string) => '#/' + path.replace(/^\//, '');
