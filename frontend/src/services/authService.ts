/**
 * Auth service — WebAuthn passkey registration and login.
 */

import { api } from "./apiClient";
import type { User, AuthResponse } from "@/types/auth";

type SerializedCredentialDescriptor = Omit<PublicKeyCredentialDescriptor, "id"> & {
  id: string;
};

type SerializedRegistrationOptions = Omit<
  PublicKeyCredentialCreationOptions,
  "challenge" | "excludeCredentials" | "user"
> & {
  challenge: string;
  excludeCredentials?: SerializedCredentialDescriptor[];
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
};

type SerializedAuthenticationOptions = Omit<
  PublicKeyCredentialRequestOptions,
  "allowCredentials" | "challenge"
> & {
  allowCredentials?: SerializedCredentialDescriptor[];
  challenge: string;
};

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToArrayBuffer(b64: string): ArrayBuffer {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - padded.length % 4) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Serialize WebAuthn credential for transport */
function serializeCredential(cred: PublicKeyCredential): object {
  const response = cred.response;
  if (response instanceof AuthenticatorAttestationResponse) {
    return {
      id: cred.id,
      rawId: arrayBufferToBase64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
        attestationObject: arrayBufferToBase64url(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
    };
  } else if (response instanceof AuthenticatorAssertionResponse) {
    return {
      id: cred.id,
      rawId: arrayBufferToBase64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
        authenticatorData: arrayBufferToBase64url(response.authenticatorData),
        signature: arrayBufferToBase64url(response.signature),
        userHandle: response.userHandle ? arrayBufferToBase64url(response.userHandle) : null,
      },
    };
  }
  throw new Error("Unknown credential response type");
}

/** Deserialize options from server for navigator.credentials.create */
function deserializeRegistrationOptions(options: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const serialized = options as unknown as SerializedRegistrationOptions;
  return {
    ...serialized,
    challenge: base64urlToArrayBuffer(serialized.challenge),
    user: {
      ...serialized.user,
      id: base64urlToArrayBuffer(serialized.user.id),
    },
    excludeCredentials: (serialized.excludeCredentials ?? []).map(
      (c) => ({ ...c, type: c.type ?? "public-key", id: base64urlToArrayBuffer(c.id) })
    ),
  };
}

function deserializeAuthenticationOptions(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const serialized = options as unknown as SerializedAuthenticationOptions;
  return {
    ...serialized,
    challenge: base64urlToArrayBuffer(serialized.challenge),
    allowCredentials: (serialized.allowCredentials ?? []).map(
      (c) => ({ ...c, type: c.type ?? "public-key", id: base64urlToArrayBuffer(c.id) })
    ),
  };
}

export const authService = {
  async register(username: string, displayName: string): Promise<User> {
    // 1. Get options
    const options = await api.post<Record<string, unknown>>("/auth/register/options", {
      username,
      display_name: displayName,
    });

    // 2. Create credential with authenticator
    const cred = await navigator.credentials.create({
      publicKey: deserializeRegistrationOptions(options),
    }) as PublicKeyCredential;

    // 3. Verify with server
    const result = await api.post<AuthResponse>("/auth/register/verify", {
      username,
      display_name: displayName,
      credential: serializeCredential(cred),
    });

    return result.user;
  },

  async login(username: string): Promise<User> {
    const options = await api.post<Record<string, unknown>>("/auth/login/options", { username });

    const cred = await navigator.credentials.get({
      publicKey: deserializeAuthenticationOptions(options),
    }) as PublicKeyCredential;

    const result = await api.post<AuthResponse>("/auth/login/verify", {
      username,
      credential: serializeCredential(cred),
    });

    return result.user;
  },

  async logout(): Promise<void> {
    await api.post("/auth/logout");
  },

  async me(): Promise<User | null> {
    try {
      return await api.get<User>("/auth/me");
    } catch {
      return null;
    }
  },
};
