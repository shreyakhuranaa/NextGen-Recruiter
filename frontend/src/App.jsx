import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./state/AuthContext";
import { AuthPage } from "./views/AuthPage";
import { RecruiterDashboard } from "./views/RecruiterDashboard";
import { StudentDashboard } from "./views/StudentDashboard";

function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/student"
        element={
          <ProtectedRoute role="student">
            <AppShell>
              <StudentDashboard />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recruiter"
        element={
          <ProtectedRoute role="recruiter">
            <AppShell>
              <RecruiterDashboard />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          user ? (
            <Navigate to={user.role === "recruiter" ? "/recruiter" : "/student"} replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
    </Routes>
  );
}

export default App;
