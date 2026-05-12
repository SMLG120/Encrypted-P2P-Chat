import { api } from "./apiClient";
import type { KeyBundle } from "@/types/crypto";

export const keyService = {
  async uploadBundle(bundle: object): Promise<void> {
    await api.post("/keys/upload", bundle);
  },

  async getBundle(userId: string): Promise<KeyBundle> {
    const data = await api.get<{
      user_id: string;
      identity_public_key: string;
      signing_public_key: string;
      signed_prekey: { key_id: number; public_key: string; signature: string };
      one_time_prekey: { key_id: number; public_key: string } | null;
    }>(`/keys/bundle/${userId}`);

    return {
      userId: data.user_id,
      identityPublicKey: data.identity_public_key,
      signingPublicKey: data.signing_public_key,
      signedPrekey: {
        keyId: data.signed_prekey.key_id,
        publicKey: data.signed_prekey.public_key,
        signature: data.signed_prekey.signature,
      },
      oneTimePrekey: data.one_time_prekey
        ? { keyId: data.one_time_prekey.key_id, publicKey: data.one_time_prekey.public_key }
        : undefined,
    };
  },

  async getStatus() {
    return api.get<{
      one_time_prekeys_remaining: number;
      signed_prekey_active: boolean;
      identity_key_uploaded: boolean;
      needs_replenishment: boolean;
    }>("/keys/status");
  },
};
