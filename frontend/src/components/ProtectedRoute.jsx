import { Navigate } from "react-router-dom";

import { useAuth } from "../state/AuthContext";

export function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sand">
        <div className="rounded-3xl bg-white px-8 py-6 shadow-panel">Loading workspace...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={user.role === "recruiter" ? "/recruiter" : "/student"} replace />;
  }

  return children;
}
