import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../state/AuthContext";

const studentDefaults = {
  name: "",
  email: "",
  password: "",
  role: "student",
  headline: "",
  university: "",
  targetRole: "",
  skills: "",
};

const recruiterDefaults = {
  name: "",
  email: "",
  password: "",
  role: "recruiter",
  company: "",
  title: "",
};

export function AuthPage() {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("student");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [studentForm, setStudentForm] = useState(studentDefaults);
  const [recruiterForm, setRecruiterForm] = useState(recruiterDefaults);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user =
        mode === "login"
          ? await login(loginForm)
          : await register(
              role === "student"
                ? {
                    ...studentForm,
                    skills: studentForm.skills
                      .split(",")
                      .map((skill) => skill.trim())
                      .filter(Boolean),
                  }
                : recruiterForm
            );

      navigate(user.role === "recruiter" ? "/recruiter" : "/student");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  const activeRegisterForm = role === "student" ? studentForm : recruiterForm;
  const setActiveRegisterForm = role === "student" ? setStudentForm : setRecruiterForm;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.16),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.15),_transparent_30%),linear-gradient(180deg,_#f8f5ef,_#f2ede5)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/70 bg-slate-950 p-10 text-white shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-300">
            Production-ready foundation
          </p>
          <h1 className="mt-4 max-w-lg text-5xl font-bold leading-tight">
            AI interviews for students. Hiring intelligence for recruiters.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-300">
            Students can practice and take structured AI interviews, track scores, and monitor job
            applications. Recruiters can create jobs, review candidate performance, and analyze the
            hiring funnel from one workspace.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ["JWT Auth", "Role-based access"],
              ["AI Scoring", "Interview analytics"],
              ["Dashboards", "Student + recruiter"],
            ].map(([title, subtitle]) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
          <div className="mb-6 flex rounded-2xl bg-slate-100 p-1">
            {[
              ["login", "Sign In"],
              ["register", "Create Account"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError("");
                }}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold ${
                  mode === value ? "bg-white text-slate-900 shadow" : "text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "register" ? (
            <div className="mb-4 flex gap-2">
              {["student", "recruiter"].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    role === value ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "login" ? (
              <>
                <Field
                  label="Email"
                  value={loginForm.email}
                  onChange={(value) => setLoginForm((current) => ({ ...current, email: value }))}
                />
                <Field
                  label="Password"
                  type="password"
                  value={loginForm.password}
                  onChange={(value) => setLoginForm((current) => ({ ...current, password: value }))}
                />
              </>
            ) : (
              <>
                <Field
                  label="Name"
                  value={activeRegisterForm.name}
                  onChange={(value) =>
                    setActiveRegisterForm((current) => ({ ...current, name: value, role }))
                  }
                />
                <Field
                  label="Email"
                  value={activeRegisterForm.email}
                  onChange={(value) =>
                    setActiveRegisterForm((current) => ({ ...current, email: value, role }))
                  }
                />
                <Field
                  label="Password"
                  type="password"
                  value={activeRegisterForm.password}
                  onChange={(value) =>
                    setActiveRegisterForm((current) => ({ ...current, password: value, role }))
                  }
                />
                {role === "student" ? (
                  <>
                    <Field
                      label="Headline"
                      value={studentForm.headline}
                      onChange={(value) => setStudentForm((current) => ({ ...current, headline: value }))}
                    />
                    <Field
                      label="University"
                      value={studentForm.university}
                      onChange={(value) =>
                        setStudentForm((current) => ({ ...current, university: value }))
                      }
                    />
                    <Field
                      label="Target Role"
                      value={studentForm.targetRole}
                      onChange={(value) =>
                        setStudentForm((current) => ({ ...current, targetRole: value }))
                      }
                    />
                    <Field
                      label="Skills (comma separated)"
                      value={studentForm.skills}
                      onChange={(value) => setStudentForm((current) => ({ ...current, skills: value }))}
                    />
                  </>
                ) : (
                  <>
                    <Field
                      label="Company"
                      value={recruiterForm.company}
                      onChange={(value) =>
                        setRecruiterForm((current) => ({ ...current, company: value }))
                      }
                    />
                    <Field
                      label="Recruiter Title"
                      value={recruiterForm.title}
                      onChange={(value) => setRecruiterForm((current) => ({ ...current, title: value }))}
                    />
                  </>
                )}
              </>
            )}

            {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Please wait..." : mode === "login" ? "Access Platform" : "Create Workspace"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand"
      />
    </label>
  );
}
