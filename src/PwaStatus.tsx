import { useRegisterSW } from 'virtual:pwa-register/react';

// Mount only in a browser. Native installations already bundle every app asset.
export default function PwaStatus() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  return needRefresh ? <div className="update-banner">A new version is ready. Your saved diary will stay here.<button onClick={() => void updateServiceWorker(true)}>Update app</button></div> : null;
}
