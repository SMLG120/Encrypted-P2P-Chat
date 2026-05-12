import { Link } from "react-router-dom";
import { Lock } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center text-center px-4">
      <div>
        <p className="font-mono text-cyan text-sm mb-2">404</p>
        <h1 className="text-3xl font-display font-bold text-text-primary mb-4">Page not found</h1>
        <p className="text-text-secondary mb-8">This route doesn't exist.</p>
        <Link to="/" className="btn-primary inline-flex items-center gap-2">
          <Lock size={14} />
          Back to Crypt
        </Link>
      </div>
    </div>
  );
}
