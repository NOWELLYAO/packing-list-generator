import { useEffect, useState } from 'react';
import { loadLogoInfo, type LogoInfo } from './drawing';

/** Proportions du logo des Réglages, pour le poser sur les colis dessinés */
export function useLogoInfo(href: string | undefined): LogoInfo | undefined {
  const [info, setInfo] = useState<LogoInfo | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadLogoInfo(href ?? '').then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [href]);
  return href ? info : undefined;
}
