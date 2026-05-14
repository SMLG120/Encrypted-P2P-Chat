import { create } from "zustand";
import type { User } from "@/types/auth";

export type EncryptionSetupStatus =
  | "idle"
  | "checking"
  | "generating"
  | "uploading"
  | "ready"
  | "failed";

interface AuthStore {
  user: User | null;
  isLoading: boolean;
  encryptionSetupStatus: EncryptionSetupStatus;
  encryptionSetupError: string | null;
  isEncryptionReady: boolean;
  setUser: (user: User | null) => void;
  setLoading: (isLoading: boolean) => void;
  setEncryptionSetupStatus: (status: EncryptionSetupStatus) => void;
  setEncryptionSetupError: (error: string | null) => void;
  resetEncryptionSetup: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: true,
  encryptionSetupStatus: "idle",
  encryptionSetupError: null,
  isEncryptionReady: false,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
  setEncryptionSetupStatus: (status) =>
    set({ encryptionSetupStatus: status, isEncryptionReady: status === "ready" }),
  setEncryptionSetupError: (error) => set({ encryptionSetupError: error }),
  resetEncryptionSetup: () =>
    set({
      encryptionSetupStatus: "idle",
      encryptionSetupError: null,
      isEncryptionReady: false,
    }),
}));
