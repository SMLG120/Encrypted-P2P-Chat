import { Link } from "react-router-dom";
import { Shield, Lock, Server, Smartphone, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { motion } from "framer-motion";

const protects = [
  "Message content is end-to-end encrypted — server stores only ciphertext",
  "Private keys are generated on-device and never transmitted",
  "WebAuthn passkeys replace passwords — no password database to breach",
  "One-time prekeys provide per-session forward secrecy",
  "Double Ratchet ensures past messages can't be decrypted with current keys",
  "WebRTC P2P transport bypasses the server for online users",
  "Rate limiting prevents brute-force and enumeration attacks",
  "HttpOnly, Secure, SameSite=Strict session cookies",
];

const doesNotProtect = [
  "Endpoint compromise: if your device is infected, an attacker can read messages",
  "Metadata: the server knows who talks to whom, and when",
  "Message ordering and timing patterns are visible to the server",
  "This implementation is NOT independently security-audited",
  "Key backup: if you lose your device and IndexedDB data, session keys are gone",
  "Group messaging does not yet implement Sender Keys (every member gets individual encryption)",
];

const cryptoFlow = [
  {
    step: "1",
    title: "Registration",
    desc: "WebAuthn creates a passkey on your device. X25519 identity key + Ed25519 signing key + 20 one-time prekeys are generated client-side. Only public keys are sent to the server.",
    icon: Smartphone,
  },
  {
    step: "2",
    title: "Session Initiation (X3DH)",
    desc: "Alice fetches Bob's public key bundle. Four Diffie-Hellman operations produce a shared secret SK. A one-time prekey is consumed atomically — never reused.",
    icon: Lock,
  },
  {
    step: "3",
    title: "Double Ratchet",
    desc: "Each message advances the ratchet, deriving a fresh per-message key. Compromise of key N does not compromise keys 1..N-1 (forward secrecy) or N+1..∞ (break-in recovery).",
    icon: Shield,
  },
  {
    step: "4",
    title: "Transport",
    desc: "Online users communicate via WebRTC DataChannels (P2P). Offline messages are stored server-side as ciphertext and delivered on reconnect via WebSocket relay.",
    icon: Server,
  },
];

export default function SecurityModel() {
  return (
    <div className="min-h-screen bg-void grid-bg">
      <div className="scan-overlay" />

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border/50">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
            <Lock size={14} className="text-cyan" />
          </div>
          <span className="font-display font-semibold text-text-primary">Crypt</span>
        </Link>
        <Link to="/register" className="btn-primary text-sm">Get Started</Link>
      </nav>

      <main className="max-w-4xl mx-auto px-8 py-16">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-16 text-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan/20 bg-cyan/5 mb-6">
            <Shield size={12} className="text-cyan" />
            <span className="text-xs font-mono text-cyan">Threat Model & Security Architecture</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-text-primary mb-4">
            What the server <span className="text-gradient-cyan">can and cannot</span> see
          </h1>
          <p className="text-text-secondary max-w-2xl mx-auto">
            Crypt is designed so the server is a blind relay. It stores encrypted bytes it cannot 
            interpret. This page explains the cryptographic design, its guarantees, and its limits.
          </p>
        </motion.div>

        {/* Crypto flow */}
        <section className="mb-16">
          <h2 className="text-xl font-display font-semibold text-text-primary mb-6">
            Cryptographic Flow
          </h2>
          <div className="grid gap-4">
            {cryptoFlow.map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass rounded-xl p-5 flex gap-4"
              >
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-cyan/10 border border-cyan/20 flex items-center justify-center">
                    <item.icon size={18} className="text-cyan" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-text-muted">Step {item.step}</span>
                    <h3 className="text-sm font-display font-semibold text-text-primary">{item.title}</h3>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* What is / isn't protected */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* Protected */}
          <div className="glass rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <CheckCircle size={16} className="text-emerald" />
              <h2 className="text-base font-display font-semibold text-text-primary">What is protected</h2>
            </div>
            <ul className="space-y-2.5">
              {protects.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle size={12} className="text-emerald mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-text-secondary leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Not protected */}
          <div className="glass rounded-xl p-6 border-rose/10">
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle size={16} className="text-amber" />
              <h2 className="text-base font-display font-semibold text-text-primary">What is NOT protected</h2>
            </div>
            <ul className="space-y-2.5">
              {doesNotProtect.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <XCircle size={12} className="text-rose/70 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-text-secondary leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="glass rounded-xl p-6 border border-amber/20 bg-amber/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber" />
            <h3 className="text-sm font-display font-semibold text-amber">Portfolio Disclaimer</h3>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">
            This application is built as an educational portfolio project demonstrating Signal-protocol 
            cryptography, WebAuthn passkeys, WebRTC P2P, and modern full-stack architecture. While the 
            cryptographic design follows well-established specifications (X3DH, Double Ratchet, HKDF-SHA256, 
            AES-256-GCM), the implementation has <strong className="text-text-primary">not been independently 
            audited</strong>. Do not use this application for communication where your safety depends on it. 
            For that, use Signal, WhatsApp, or another production-audited messenger.
          </p>
        </div>

        {/* Library credits */}
        <div className="mt-12 pt-8 border-t border-border">
          <h2 className="text-sm font-display font-semibold text-text-primary mb-4">Cryptographic Libraries</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: "@noble/curves", desc: "X25519, Ed25519" },
              { name: "@noble/hashes", desc: "HKDF-SHA256" },
              { name: "WebCrypto API", desc: "AES-256-GCM" },
              { name: "py_webauthn", desc: "WebAuthn/passkeys" },
            ].map((lib) => (
              <div key={lib.name} className="glass rounded-lg p-3">
                <p className="text-xs font-mono text-cyan mb-0.5">{lib.name}</p>
                <p className="text-xs text-text-muted">{lib.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
