import { useEffect, useState } from 'react';

// Blocks (and the stats computed from them) are pulled from the account in the
// background after the app opens. This hook re-renders a screen when that pull
// finishes, so a second device shows the real numbers instead of zeros.
export const BLOCKS_SYNCED_EVENT = 'ujo:blocks-synced';

export const useBlocksSynced = (): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((x) => x + 1);
    window.addEventListener(BLOCKS_SYNCED_EVENT, h);
    return () => window.removeEventListener(BLOCKS_SYNCED_EVENT, h);
  }, []);
  return tick;
};
