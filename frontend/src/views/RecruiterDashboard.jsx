import { useEffect, useMemo, useState } from "react";

import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";
import { api } from "../lib/api";

const jobDefaults = {
  title: "",
  department: "",
  location: "",
  description: "",
  requirements: "",
  interviewFocus: "",
  status: "active",
};

export function RecruiterDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [form, setForm] = useState(jobDefaults);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [candidates, setCandidates] = useState([]);

  async function load() {
    const response = await api.get("/recruiter/dashboard");
    setDashboard(response.data);
    if (!selectedJobId && response.data.jobs[0]) {
      setSelectedJobId(response.data.jobs[0].id);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    api.get(`/recruiter/jobs/${selectedJobId}/candidates`).then((response) => {
      setCandidates(response.data.candidates);
    });
  }, [selectedJobId, dashboard?.jobs?.length]);

  const selectedJob = useMemo(
    () => dashboard?.jobs?.find((job) => job.id === selectedJobId) || null,
    [dashboard, selectedJobId]
  );

  async function createJob(event) {
    event.preventDefault();
    await api.post("/recruiter/jobs", {
      ...form,
      requirements: form.requirements
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });
    setForm(jobDefaults);
    await load();
  }

  if (!dashboard) {
    return <div className="rounded-3xl bg-white p-6 shadow-panel">Loading recruiter workspace...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-5">
        <StatCard label="Jobs" value={dashboard.summary.jobs} hint="total roles" />
        <StatCard label="Active Jobs" value={dashboard.summary.activeJobs} hint="currently hiring" />
        <StatCard label="Applications" value={dashboard.summary.applications} hint="candidate funnel" />
        <StatCard label="Completed Interviews" value={dashboard.summary.completedInterviews} hint="AI scored" />
        <StatCard label="Average Score" value={dashboard.summary.averageInterviewScore} hint="talent quality" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <SectionCard title="Create Job" subtitle="Launch a new role and define its AI interview focus.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={createJob}>
            <Field label="Title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />
            <Field
              label="Department"
              value={form.department}
              onChange={(value) => setForm((current) => ({ ...current, department: value }))}
            />
            <Field
              label="Location"
              value={form.location}
              onChange={(value) => setForm((current) => ({ ...current, location: value }))}
            />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Status</span>
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-brand"
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <TextArea
              label="Description"
              value={form.description}
              onChange={(value) => setForm((current) => ({ ...current, description: value }))}
            />
            <TextArea
              label="Requirements (comma separated)"
              value={form.requirements}
              onChange={(value) => setForm((current) => ({ ...current, requirements: value }))}
            />
            <div className="md:col-span-2">
              <TextArea
                label="Interview Focus"
                value={form.interviewFocus}
                onChange={(value) => setForm((current) => ({ ...current, interviewFocus: value }))}
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Publish Job
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Job Pipeline" subtitle="Select a job to review candidate applications and AI interview outcomes.">
          <div className="mb-5 flex flex-wrap gap-2">
            {dashboard.jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  selectedJobId === job.id ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {job.title}
              </button>
            ))}
          </div>

          {selectedJob ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-xl font-semibold text-ink">{selectedJob.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{selectedJob.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedJob.requirements.map((item) => (
                  <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-brand">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {candidates.length ? (
              candidates.map((candidate) => (
                <div key={candidate.applicationId} className="rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h4 className="text-lg font-semibold text-ink">{candidate.student.name}</h4>
                      <p className="text-sm text-slate-500">{candidate.student.email}</p>
                      <p className="mt-2 text-sm text-slate-600">{candidate.student.headline}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {candidate.student.skills.map((skill) => (
                          <span key={skill} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Application Status
                      </p>
                      <p className="mt-2 font-semibold text-ink">{candidate.status}</p>
                      {candidate.latestInterview ? (
                        <div className="mt-2 space-y-2 text-sm">
                          <p className="text-brand">
                            Score {candidate.latestInterview.overallScore} - {candidate.latestInterview.recommendation}
                          </p>
                          <div className="text-left text-slate-600">
                            <p className="font-semibold text-slate-800">Strengths</p>
                            <ul className="mt-1 space-y-1">
                              {(candidate.latestInterview.strengths || []).slice(0, 2).map((item) => (
                                <li key={item}>- {item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">Interview pending</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-slate-500">
                No candidates yet for this job.
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-brand"
      />
    </label>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <label className="block md:col-span-2">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-brand"
      />
    </label>
  );
}
