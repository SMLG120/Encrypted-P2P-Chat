import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Fingerprint, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { authService } from "@/services/authService";
import { keyService } from "@/services/keyService";
import { setupIdentity } from "@/crypto/cryptoService";
import { useAuthStore } from "@/stores/authStore";
import { parseApiError } from "@/lib/errors";

type Step = "form" | "passkey" | "keys" | "done";

export default function Register() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStep("passkey");

    try {
      // 1. WebAuthn registration
      const user = await authService.register(username, displayName);
      setUser(user);

      // 2. Generate & upload crypto keys
      setStep("keys");
      await setupIdentity((bundle) => keyService.uploadBundle(bundle));

      setStep("done");
      setTimeout(() => navigate("/chat"), 1200);
    } catch (err) {
      setError(parseApiError(err));
      setStep("form");
    }
  };

  return (
    <div className="min-h-screen bg-void grid-bg flex items-center justify-center px-4">
      <div className="scan-overlay" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center glow-cyan">
            <Lock size={18} className="text-cyan" />
          </div>
          <span className="font-display text-xl font-bold text-text-primary">Crypt</span>
        </div>

        <div className="glass-bright rounded-2xl p-8 shadow-panel">
          <h1 className="text-xl font-display font-bold text-text-primary mb-1">Create account</h1>
          <p className="text-sm text-text-secondary mb-6">
            Your passkey and encryption keys are generated on this device.
          </p>

          {step === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-text-muted mb-1.5">USERNAME</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alice"
                  pattern="^[a-zA-Z0-9_.-]+$"
                  minLength={3}
                  required
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-text-muted mb-1.5">DISPLAY NAME</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice"
                  required
                  className="input-field"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-rose text-sm p-3 bg-rose/5 rounded-lg border border-rose/20">
                  <AlertCircle size={14} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2 mt-2">
                <Fingerprint size={16} />
                Register with Passkey
              </button>
            </form>
          )}

          {step === "passkey" && (
            <StepDisplay
              icon={<Fingerprint size={32} className="text-cyan animate-pulse" />}
              title="Touch your authenticator"
              desc="Use your passkey — fingerprint, Face ID, or security key."
            />
          )}

          {step === "keys" && (
            <StepDisplay
              icon={<Loader2 size={32} className="text-emerald animate-spin" />}
              title="Generating encryption keys"
              desc="Creating your X25519 identity key, signed prekey, and 20 one-time prekeys…"
            />
          )}

          {step === "done" && (
            <StepDisplay
              icon={<CheckCircle size={32} className="text-emerald" />}
              title="You're in"
              desc="Identity keys generated and uploaded. Starting encrypted session…"
            />
          )}

          <p className="text-xs text-text-muted text-center mt-6">
            Already have an account?{" "}
            <Link to="/login" className="text-cyan hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-text-muted mt-4 font-mono">
          Private keys are generated on this device and never leave it.
        </p>
      </motion.div>
    </div>
  );
}

function StepDisplay({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      {icon}
      <div className="text-center">
        <p className="font-display font-semibold text-text-primary mb-1">{title}</p>
        <p className="text-sm text-text-secondary">{desc}</p>
      </div>
    </div>
  );
}
