import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Fingerprint, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { authService } from "@/services/authService";
import { useAuthStore } from "@/stores/authStore";
import { parseApiError } from "@/lib/errors";

export default function Login() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await authService.login(username);
      setUser(user);
      navigate("/chat");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-void grid-bg flex items-center justify-center px-4">
      <div className="scan-overlay" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center glow-cyan">
            <Lock size={18} className="text-cyan" />
          </div>
          <span className="font-display text-xl font-bold text-text-primary">Crypt</span>
        </div>

        <div className="glass-bright rounded-2xl p-8 shadow-panel">
          <h1 className="text-xl font-display font-bold text-text-primary mb-1">Welcome back</h1>
          <p className="text-sm text-text-secondary mb-6">
            Sign in with your registered passkey.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-text-muted mb-1.5">USERNAME</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alice"
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

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Fingerprint size={16} />
              )}
              {loading ? "Authenticating…" : "Sign In with Passkey"}
            </button>
          </form>

          <p className="text-xs text-text-muted text-center mt-6">
            Don't have an account?{" "}
            <Link to="/register" className="text-cyan hover:underline">
              Register
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
