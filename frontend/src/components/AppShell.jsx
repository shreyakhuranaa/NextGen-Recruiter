import { useNavigate } from "react-router-dom";

import { useAuth } from "../state/AuthContext";

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.12),_transparent_25%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.12),_transparent_22%),linear-gradient(180deg,_#faf7f2,_#f4efe8)]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">
              AI Interview Platform
            </p>
            <h1 className="mt-2 text-3xl font-bold text-ink">
              {user?.role === "recruiter" ? "Recruiter Control Center" : "Student Interview Hub"}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {user?.name} - {user?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/auth");
            }}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Sign out
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
