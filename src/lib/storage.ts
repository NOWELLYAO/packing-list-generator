import { useEffect, useRef, useState } from 'react';

const PREFIX = 'plgen:';

/** Événement émis quand une sauvegarde locale échoue (stockage plein, navigation privée…) */
export const STORAGE_ERROR_EVENT = 'plgen:storage-error';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Enregistre ; en cas d'échec, prévient l'application (au lieu d'échouer en silence) */
export function save<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Sauvegarde locale impossible', e);
    window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key, error: String(e) } }));
    return false;
  }
}

/** Taille occupée par l'application dans le navigateur (en caractères ≈ octets) */
export function storageUsage(): number {
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(PREFIX)) n += (localStorage.getItem(k) ?? '').length + k.length;
  }
  return n;
}

/**
 * useState persisté dans le navigateur, synchronisé entre onglets :
 * une modification faite dans un autre onglet est reprise ici au lieu d'être écrasée.
 */
export function usePersistent<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => load(key, initial));
  const lastRaw = useRef<string | null>(null);

  useEffect(() => {
    const raw = JSON.stringify(value);
    if (raw === lastRaw.current) return; // déjà enregistré (ou reçu d'un autre onglet)
    if (save(key, value)) lastRaw.current = raw;
  }, [key, value]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PREFIX + key || e.newValue === null) return;
      try {
        lastRaw.current = e.newValue;
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        /* valeur illisible : ignorée */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [value, setValue] as const;
}

/** Demande au navigateur de ne pas effacer les données automatiquement (si possible) */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
