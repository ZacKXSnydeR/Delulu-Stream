import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  listInstalledAddons,
  hasActiveStreamingAddon,
  setActiveAddonById,
  removeAddonById,
} from '../addon_manager/manager';
import type { AddonStateStore, AddonInstallRecord } from '../addon_manager/types';

interface AddonContextType {
  store: AddonStateStore;
  hasAddon: boolean;
  isLoading: boolean;
  refreshAddons: () => Promise<void>;
  activateAddon: (id: string) => Promise<void>;
  uninstallAddon: (id: string) => Promise<void>;
  activeAddon: AddonInstallRecord | null;
}

const AddonContext = createContext<AddonContextType | undefined>(undefined);

export const AddonProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [store, setStore] = useState<AddonStateStore>({ activeAddonId: null, addons: [] });
  const [isLoading, setIsLoading] = useState(true);

  const refreshAddons = useCallback(async () => {
    try {
      const newStore = await listInstalledAddons();
      setStore(newStore);
    } catch (error) {
      console.error('[AddonContext] Failed to refresh addons:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAddons();
  }, [refreshAddons]);

  const activateAddon = async (id: string) => {
    const newStore = await setActiveAddonById(id);
    setStore(newStore);
  };

  const uninstallAddon = async (id: string) => {
    const newStore = await removeAddonById(id);
    setStore(newStore);
  };

  const hasAddon = hasActiveStreamingAddon(store);
  const activeAddon = store.activeAddonId 
    ? store.addons.find(a => a.manifest.id === store.activeAddonId) || null 
    : null;

  return (
    <AddonContext.Provider
      value={{
        store,
        hasAddon,
        isLoading,
        refreshAddons,
        activateAddon,
        uninstallAddon,
        activeAddon,
      }}
    >
      {children}
    </AddonContext.Provider>
  );
};

export const useAddons = () => {
  const context = useContext(AddonContext);
  if (context === undefined) {
    throw new Error('useAddons must be used within an AddonProvider');
  }
  return context;
};
