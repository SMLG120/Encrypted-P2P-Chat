import { Link } from "react-router-dom";
import { Shield, Lock, Zap, Eye, Server, Key } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  {
    icon: Key,
    title: "WebAuthn Passkeys",
    desc: "Register and authenticate with hardware-backed passkeys. No passwords ever stored.",
  },
  {
    icon: Lock,
    title: "X3DH + Double Ratchet",
    desc: "Signal-protocol key agreement. Each message uses a fresh key derived from a ratcheting chain.",
  },
  {
    icon: Eye,
    title: "Zero-Knowledge Server",
    desc: "The server stores only ciphertext, public keys, and metadata. It cannot decrypt your messages.",
  },
  {
    icon: Zap,
    title: "WebRTC P2P",
    desc: "When both users are online, messages flow peer-to-peer. Server is only a fallback relay.",
  },
  {
    icon: Server,
    title: "Offline Delivery",
    desc: "Messages are encrypted and stored server-side when the recipient is offline, then delivered on reconnect.",
  },
  {
    icon: Shield,
    title: "Forward Secrecy",
    desc: "Compromise of current keys cannot decrypt past messages. One-time prekeys ensure per-session uniqueness.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-void grid-bg flex flex-col">
      {/* Scan line */}
      <div className="scan-overlay" />

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
            <Lock size={14} className="text-cyan" />
          </div>
          <span className="font-display font-semibold text-text-primary tracking-tight">Crypt</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/security" className="text-sm text-text-secondary hover:text-cyan transition-colors font-mono">
            Security Model
          </Link>
          <Link to="/login" className="btn-ghost text-sm">
            Sign In
          </Link>
          <Link to="/register" className="btn-primary text-sm">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan/20 bg-cyan/5 mb-8">
            <Shield size={12} className="text-cyan" />
            <span className="text-xs font-mono text-cyan">Zero-knowledge · End-to-end encrypted</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight mb-6 leading-[1.05]">
            Messages that{" "}
            <span className="text-gradient-cyan">only you</span>
            <br />
            can read.
          </h1>

          <p className="text-lg text-text-secondary max-w-xl mx-auto leading-relaxed mb-10">
            Built on Signal-protocol cryptography — X3DH key agreement, Double Ratchet 
            forward secrecy, and WebAuthn passkey authentication. The server never sees 
            your plaintext. Ever.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Link to="/register" className="btn-primary text-base px-8 py-3.5">
              Start Encrypted Chat
            </Link>
            <Link to="/security" className="btn-ghost text-base">
              How it works →
            </Link>
          </div>
        </motion.div>

        {/* Terminal preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-20 w-full max-w-2xl glass rounded-2xl border border-border-bright overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-panel">
            <span className="w-3 h-3 rounded-full bg-rose/60" />
            <span className="w-3 h-3 rounded-full bg-amber/60" />
            <span className="w-3 h-3 rounded-full bg-emerald/60" />
            <span className="ml-4 text-xs font-mono text-text-muted">crypt — end-to-end encrypted</span>
          </div>
          <div className="p-6 font-mono text-sm space-y-3">
            <div className="flex gap-3">
              <span className="text-text-muted">$</span>
              <span className="text-cyan">alice</span>
              <span className="text-text-secondary">→</span>
              <span className="text-emerald">[AES-256-GCM ciphertext]</span>
              <span className="ml-auto text-xs text-emerald/60 flex items-center gap-1">
                <Lock size={10} /> E2EE
              </span>
            </div>
            <div className="flex gap-3">
              <span className="text-text-muted">$</span>
              <span className="text-text-muted">server sees:</span>
              <span className="text-amber font-mono text-xs">dGhpcyBpcyBjb21wbGV0ZWx5IG9wYXF1ZQ==</span>
            </div>
            <div className="flex gap-3">
              <span className="text-text-muted">$</span>
              <span className="text-cyan">bob</span>
              <span className="text-text-secondary">decrypts:</span>
              <span className="text-text-primary">"hey, this is private 🔒"</span>
            </div>
            <div className="flex gap-3">
              <span className="text-text-muted">$</span>
              <span className="text-text-muted">ratchet step:</span>
              <span className="text-emerald">✓ new key chain derived</span>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Features */}
      <section className="px-8 py-20 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-display font-bold text-center mb-12 text-text-primary">
            Security Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className="glass rounded-xl p-5 hover:border-border-bright transition-colors duration-300"
              >
                <f.icon size={18} className="text-cyan mb-3" />
                <h3 className="text-sm font-display font-semibold text-text-primary mb-1.5">
                  {f.title}
                </h3>
                <p className="text-xs text-text-secondary leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-5 border-t border-border/50 flex items-center justify-between">
        <span className="text-xs text-text-muted font-mono">
          Educational portfolio project · Not independently audited
        </span>
        <a
          href="https://github.com"
          className="text-xs text-text-muted hover:text-cyan transition-colors font-mono"
        >
          GitHub →
        </a>
      </footer>
    </div>
  );
}
