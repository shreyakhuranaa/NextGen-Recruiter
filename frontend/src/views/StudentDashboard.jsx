import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";

let fallbackDetectorPromise = null;

async function loadFaceDetector() {
  if ("FaceDetector" in window) {
    const nativeDetector = new window.FaceDetector({
      fastMode: true,
      maxDetectedFaces: 5,
    });
    return {
      kind: "native",
      detect: (source) => nativeDetector.detect(source),
    };
  }

  if (!fallbackDetectorPromise) {
    fallbackDetectorPromise = (async () => {
      const tf = await import("@tensorflow/tfjs-core");
      await import("@tensorflow/tfjs-converter");
      await import("@tensorflow/tfjs-backend-webgl");
      const blazeface = await import("@tensorflow-models/blazeface");

      if (tf.getBackend() !== "webgl") {
        await tf.setBackend("webgl");
      }
      await tf.ready();

      const model = await blazeface.load();
      return {
        kind: "blazeface",
        detect: async (source) => model.estimateFaces(source, false),
      };
    })().catch((error) => {
      fallbackDetectorPromise = null;
      throw error;
    });
  }

  return fallbackDetectorPromise;
}

export function StudentDashboard({ secureMode = false }) {
  const { user } = useAuth();
  const { attemptId } = useParams();
  const [dashboard, setDashboard] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeAttempt, setActiveAttempt] = useState(null);
  const [responseText, setResponseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("Idle");
  const [autoListenToken, setAutoListenToken] = useState(0);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [secureModeReady, setSecureModeReady] = useState(!secureMode);
  const [securityMessage, setSecurityMessage] = useState(
    secureMode ? "Preparing secure interview workspace..." : ""
  );
  const securityCooldownRef = useRef(0);

  const secureInterviewActive = secureMode && activeAttempt?.status === "in_progress";
  const interviewReady = !secureMode || secureModeReady;
  const inProgressAttempt = useMemo(
    () => (!secureMode ? dashboard?.attempts?.find((attempt) => attempt.status === "in_progress") || null : null),
    [dashboard, secureMode]
  );

  async function load() {
    const [dashboardResponse, jobsResponse] = await Promise.all([
      api.get("/student/dashboard"),
      api.get("/jobs"),
    ]);
    setDashboard(dashboardResponse.data);
    setJobs(jobsResponse.data.jobs);
  }

  async function loadAttempt(targetAttemptId) {
    if (!targetAttemptId) {
      return;
    }
    try {
      const response = await api.get(`/student/interviews/${targetAttemptId}`);
      setActiveAttempt(response.data.attempt);
      setConnectionMessage("");
    } catch (_error) {
      setConnectionMessage("Connection interrupted. Reconnecting to your saved interview...");
    }
  }

  useEffect(() => {
    if (secureMode) {
      loadAttempt(attemptId);
      return;
    }
    load();
  }, [secureMode, attemptId]);

  const unansweredQuestion = useMemo(
    () => activeAttempt?.questions?.find((question) => !question.answer) || null,
    [activeAttempt]
  );

  useEffect(() => {
    if (!unansweredQuestion || activeAttempt?.status !== "in_progress" || !interviewReady) {
      return;
    }
    speakQuestion(unansweredQuestion.prompt, setVoiceStatus, () => {
      setAutoListenToken((value) => value + 1);
    });
  }, [unansweredQuestion?.id, activeAttempt?.status, interviewReady]);

  async function apply(jobId) {
    await api.post(`/jobs/${jobId}/apply`);
    await load();
  }

  async function startInterview(jobId) {
    const interviewTab = window.open("", "_blank");
    try {
      const response = await api.post(`/jobs/${jobId}/interviews/start`);
      setActiveAttempt(null);
      setResponseText("");
      setWarningMessage("");
      setResumeMessage(
        response.data.resumed
          ? "Your previous in-progress interview was reopened in the secure tab."
          : "Interview opened in a secure full-screen tab."
      );
      await load();
      if (interviewTab) {
        interviewTab.location.href = `/student/interview/${response.data.attempt.id}`;
        interviewTab.focus();
      } else {
        window.location.href = `/student/interview/${response.data.attempt.id}`;
      }
    } catch (error) {
      interviewTab?.close();
      setResumeMessage(error.response?.data?.message || "Unable to start the interview.");
    }
  }

  function openSecureInterview(targetAttemptId) {
    if (!targetAttemptId) {
      return;
    }
    const tab = window.open(`/student/interview/${targetAttemptId}`, "_blank");
    if (tab) {
      tab.focus();
    } else {
      window.location.href = `/student/interview/${targetAttemptId}`;
    }
  }

  async function submitAnswer(transcriptOverride) {
    const finalAnswer = typeof transcriptOverride === "string" ? transcriptOverride.trim() : responseText.trim();
    if (!unansweredQuestion || !finalAnswer || busy) return;
    setBusy(true);
    try {
      await api.post(`/student/interviews/${activeAttempt.id}/answers`, {
        questionId: unansweredQuestion.id,
        responseText: finalAnswer,
      });
      const refreshed = await api.get(`/student/interviews/${activeAttempt.id}`);
      setActiveAttempt(refreshed.data.attempt);
      setResponseText("");
      setVoiceStatus("Answer submitted. Loading next question...");
    } catch (error) {
      if (error.response?.status === 409 || error.response?.status === 400) {
        const refreshed = await api.get(`/student/interviews/${activeAttempt.id}`);
        setActiveAttempt(refreshed.data.attempt);
        setResponseText("");
        setVoiceStatus("Answer was already recorded. Moving to the latest question...");
      } else {
        setVoiceStatus(error.response?.data?.message || "Answer submission failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function completeInterview() {
    if (!activeAttempt) return;
    const response = await api.post(`/student/interviews/${activeAttempt.id}/complete`);
    setActiveAttempt(response.data.attempt);
    if (!secureMode) {
      await load();
    }
  }

  const issueWarning = useCallback(async (reason) => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") return;
    const response = await api.post(`/student/interviews/${activeAttempt.id}/proctor-warning`, {
      reason,
    });
    setActiveAttempt(response.data.attempt);
    if (response.data.terminated) {
      setWarningMessage("Interview closed after 3 proctoring warnings.");
      if (!secureMode) {
        await load();
      }
      return;
    }
    setWarningMessage(`Warning ${response.data.attempt.warningCount}/3: ${reason}`);
  }, [activeAttempt, secureMode]);

  async function uploadResume() {
    if (!resumeFile) return;
    setResumeBusy(true);
    setResumeMessage("");
    try {
      const formData = new FormData();
      formData.append("resume", resumeFile);
      await api.post("/student/resume", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      setResumeMessage("Resume parsed successfully. You can start the interview now.");
      setResumeFile(null);
      await load();
    } catch (error) {
      setResumeMessage(error.response?.data?.message || "Resume parsing failed.");
    } finally {
      setResumeBusy(false);
    }
  }

  const enterSecureFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setSecureModeReady(Boolean(document.fullscreenElement));
      setSecurityMessage(
        document.fullscreenElement
          ? "Secure fullscreen mode active."
          : "Fullscreen access is required to continue."
      );
    } catch (_error) {
      setSecureModeReady(Boolean(document.fullscreenElement));
      setSecurityMessage("Click Enter Full Screen to continue the interview securely.");
    }
  }, []);

  const reportSecureViolation = useCallback(
    async (reason, message) => {
      const now = Date.now();
      if (now - securityCooldownRef.current < 10000) {
        return;
      }
      securityCooldownRef.current = now;
      setSecurityMessage(message);
      await issueWarning(reason);
    },
    [issueWarning]
  );

  useEffect(() => {
    if (!secureInterviewActive) {
      setSecureModeReady(!secureMode);
      return;
    }

    enterSecureFullscreen();

    function onFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setSecureModeReady(active);
      if (!active) {
        reportSecureViolation(
          "Candidate exited secure fullscreen mode",
          "Fullscreen exited. Return immediately to avoid termination."
        );
      } else {
        setSecurityMessage("Secure fullscreen mode active.");
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        reportSecureViolation(
          "Candidate switched away from the secure interview tab",
          "Interview tab focus was lost. Stay on this tab to continue."
        );
      }
    }

    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    function blockClipboardAction(event) {
      event.preventDefault();
      setSecurityMessage("Copy, paste, and right-click are disabled during the secure interview.");
    }

    function onKeyDown(event) {
      const lowerKey = String(event.key || "").toLowerCase();
      const blockedCombo =
        (event.ctrlKey || event.metaKey) &&
        ["c", "x", "v", "a", "p", "s"].includes(lowerKey);
      if (blockedCombo) {
        const actionable = event.target?.closest?.("textarea, input");
        if (actionable && ["a"].includes(lowerKey)) {
          return;
        }
        event.preventDefault();
        setSecurityMessage("Clipboard and shortcut actions are restricted in secure mode.");
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("copy", blockClipboardAction);
    document.addEventListener("cut", blockClipboardAction);
    document.addEventListener("paste", blockClipboardAction);
    document.addEventListener("contextmenu", blockClipboardAction);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("copy", blockClipboardAction);
      document.removeEventListener("cut", blockClipboardAction);
      document.removeEventListener("paste", blockClipboardAction);
      document.removeEventListener("contextmenu", blockClipboardAction);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [enterSecureFullscreen, reportSecureViolation, secureInterviewActive, secureMode]);

  useEffect(() => {
    if (!secureInterviewActive || !attemptId) {
      return undefined;
    }

    const pollId = window.setInterval(() => {
      loadAttempt(attemptId);
    }, 8000);

    return () => window.clearInterval(pollId);
  }, [attemptId, secureInterviewActive]);

  useEffect(() => {
    if (!secureMode) {
      return undefined;
    }

    function handleOffline() {
      setConnectionMessage("Connection lost. Your progress is saved locally on the server. Reconnecting...");
    }

    function handleOnline() {
      setConnectionMessage("Connection restored. Resuming your interview...");
      loadAttempt(attemptId);
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [attemptId, secureMode]);

  if (secureMode && !activeAttempt) {
    return <div className="min-h-screen bg-slate-950 px-6 py-10 text-white">Loading secure interview...</div>;
  }

  if (!secureMode && !dashboard) {
    return <div className="rounded-3xl bg-white p-6 shadow-panel">Loading dashboard...</div>;
  }

  if (secureMode) {
    return (
      <SecureInterviewPage
        activeAttempt={activeAttempt}
        autoListenToken={autoListenToken}
        busy={busy}
        completeInterview={completeInterview}
        enterSecureFullscreen={enterSecureFullscreen}
        interviewReady={interviewReady}
        issueWarning={issueWarning}
        responseText={responseText}
        secureModeReady={secureModeReady}
        securityMessage={securityMessage}
        connectionMessage={connectionMessage}
        setAutoListenToken={setAutoListenToken}
        setResponseText={setResponseText}
        submitAnswer={submitAnswer}
        voiceStatus={voiceStatus}
        warningMessage={warningMessage}
        setVoiceStatus={setVoiceStatus}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Applications" value={dashboard.summary.applications} hint="job pipeline" />
        <StatCard label="Interviews Taken" value={dashboard.summary.interviewsTaken} hint="practice + live" />
        <StatCard label="Average Score" value={dashboard.summary.averageScore} hint="performance trend" />
        <StatCard label="Best Score" value={dashboard.summary.bestScore} hint="top interview" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Open Jobs"
          subtitle="Upload a resume first, then launch a resume-driven interview from the student workspace."
        >
          <div className="mb-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex-1">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Resume Intake</p>
                <p className="mt-2 text-sm text-slate-600">
                  Upload a PDF or DOCX resume. The platform parses it from scratch, generates targeted questions, and builds the final report from your responses.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={(event) => setResumeFile(event.target.files?.[0] || null)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                />
                <button
                  type="button"
                  onClick={uploadResume}
                  disabled={!resumeFile || resumeBusy}
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                >
                  {resumeBusy ? "Parsing Resume..." : "Upload Resume"}
                </button>
              </div>
            </div>
            {resumeMessage ? (
              <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">{resumeMessage}</div>
            ) : null}
          </div>

          <div className="space-y-4">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{job.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {job.department || "General"} - {job.location || "Remote"}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{job.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.requirements.map((item) => (
                        <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => apply(job.id)}
                      className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => startInterview(job.id)}
                      disabled={!dashboard.resume}
                      className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                    >
                      Start AI Interview
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Student Snapshot"
          subtitle="Profile summary plus recent AI interview results."
        >
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-lg font-semibold text-ink">{user.name}</p>
            <p className="mt-1 text-sm text-slate-500">{user.profile?.headline || "Student profile"}</p>
            <p className="mt-4 text-sm text-slate-600">
              {user.profile?.university || "University not set"} - Target role:{" "}
              {user.profile?.target_role || "Open"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(user.profile?.skills || []).map((skill) => (
                <span key={skill} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-brand">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {dashboard.resume?.parsed ? (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Parsed Resume</p>
                  <p className="mt-1 text-sm text-slate-500">{dashboard.resume.filename}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {dashboard.resume.parsed.wordCount} words
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{dashboard.resume.parsed.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(dashboard.resume.parsed.skills || []).map((skill) => (
                  <span key={skill} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500">
              Upload a resume to unlock interview question generation and score reporting.
            </div>
          )}

          {inProgressAttempt ? (
            <div className="mt-5 rounded-3xl border border-teal-200 bg-teal-50 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Interview Ready To Resume</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Your {inProgressAttempt.job.title} interview is still in progress. Reopen the secure tab and continue where you left off.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openSecureInterview(inProgressAttempt.id)}
                  className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  Resume Secure Interview
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            {dashboard.attempts.map((attempt) => (
              <div key={attempt.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-ink">{attempt.job.title}</p>
                    <p className="text-sm text-slate-500">{attempt.status.replace("_", " ")}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                    {attempt.overallScore}
                  </span>
                </div>
                {attempt.recommendation ? (
                  <p className="mt-3 text-sm text-slate-600">{attempt.recommendation}</p>
                ) : null}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {activeAttempt ? (
        <SectionCard
          title={`Interview in Progress: ${activeAttempt.job.title}`}
          subtitle="Respond to each question and finalize to get AI-generated performance insights."
          action={
            activeAttempt.status === "in_progress" ? (
              <button
                type="button"
                onClick={completeInterview}
                className="rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
              >
                Complete Interview
              </button>
            ) : null
          }
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_0.92fr]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              {warningMessage ? (
                <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {warningMessage}
                </div>
              ) : null}
              {activeAttempt.status === "terminated" ? (
                <div>
                  <h3 className="text-xl font-semibold text-ink">Interview terminated</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {activeAttempt.terminationReason || "Closed due to repeated proctoring violations."}
                  </p>
                </div>
              ) : unansweredQuestion ? (
                <>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">
                    Question {unansweredQuestion.position}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-ink">{unansweredQuestion.prompt}</h3>
                  <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-semibold">Live voice interview</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-teal-700">
                          Voice status: {voiceStatus}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            speakQuestion(unansweredQuestion.prompt, setVoiceStatus, () => {
                              setAutoListenToken((value) => value + 1);
                            })
                          }
                          className="rounded-2xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                        >
                          Speak Question
                        </button>
                      </div>
                    </div>
                  </div>
                  <VoiceAnswerRecorder
                    disabled={busy || activeAttempt.status !== "in_progress"}
                    onTranscriptChange={setResponseText}
                    setVoiceStatus={setVoiceStatus}
                    autoStartToken={autoListenToken}
                    onAutoSubmit={submitAnswer}
                  />
                  <textarea
                    value={responseText}
                    onChange={(event) => setResponseText(event.target.value)}
                    rows={8}
                    className="mt-5 w-full rounded-3xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-brand"
                    placeholder="Voice transcript appears here. You can edit it before submitting if needed."
                  />
                  <button
                    type="button"
                    disabled={busy || !responseText.trim()}
                    onClick={submitAnswer}
                    className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    {busy ? "Scoring response..." : "Submit Answer"}
                  </button>
                </>
              ) : (
                <div>
                  <h3 className="text-xl font-semibold text-ink">All questions answered</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Finalize the interview to compute the overall score and recruiter recommendation.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <FaceMonitor activeAttempt={activeAttempt} onWarning={issueWarning} />
              {activeAttempt.questions.map((question) => (
                <div key={question.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink">Q{question.position}</p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
                      {question.category}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{question.prompt}</p>
                  {question.answer ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        AI Feedback
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{question.answer.feedback}</p>
                      <p className="mt-3 text-sm font-semibold text-brand">
                        Score: {question.answer.score}
                      </p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {activeAttempt && ["completed", "terminated"].includes(activeAttempt.status) ? (
        <SectionCard
          title={activeAttempt.status === "terminated" ? "Interview Closed" : "Completed Interview Summary"}
          subtitle={
            activeAttempt.status === "terminated"
              ? "This interview was ended by proctoring rules after repeated multiple-face detections."
              : "AI-generated recruiter-style review of the student's latest interview."
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="Overall Score" value={activeAttempt.overallScore} hint="latest attempt" />
            <StatCard label="Recommendation" value={activeAttempt.recommendation} hint="recruiter signal" />
            <StatCard
              label="Warnings"
              value={activeAttempt.warningCount}
              hint={activeAttempt.status === "terminated" ? "threshold reached" : "proctoring"}
            />
          </div>
          {activeAttempt.report ? (
            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Score Report</p>
              <p className="mt-3 text-sm leading-6 text-slate-700">{activeAttempt.report.overallSummary}</p>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <StatCard label="Technical" value={activeAttempt.report.technicalScore} hint="rubric" />
                <StatCard label="Communication" value={activeAttempt.report.communicationScore} hint="rubric" />
                <StatCard label="Problem Solving" value={activeAttempt.report.problemSolvingScore} hint="rubric" />
              </div>
            </div>
          ) : null}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Strengths</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {activeAttempt.strengths.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">Growth Areas</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {activeAttempt.growthAreas.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function SecureInterviewPage({
  activeAttempt,
  autoListenToken,
  busy,
  completeInterview,
  enterSecureFullscreen,
  interviewReady,
  issueWarning,
  responseText,
  secureModeReady,
  securityMessage,
  connectionMessage,
  setAutoListenToken,
  setResponseText,
  submitAnswer,
  voiceStatus,
  warningMessage,
  setVoiceStatus,
}) {
  const unansweredQuestion = activeAttempt?.questions?.find((question) => !question.answer) || null;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_28%),linear-gradient(180deg,_#020617,_#111827)] px-4 py-5 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Secure Interview Mode</p>
              <h1 className="mt-2 text-3xl font-bold text-white">{activeAttempt?.job?.title}</h1>
              <p className="mt-2 text-sm text-slate-300">
                Stay in this full-screen tab during the interview. Exiting full screen or switching tabs can trigger proctoring warnings.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {activeAttempt?.status === "in_progress" ? (
                <button
                  type="button"
                  onClick={completeInterview}
                  className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400"
                >
                  Complete Interview
                </button>
              ) : null}
              <Link
                to="/student"
                className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-100">
            {securityMessage}
          </div>
          {connectionMessage ? (
            <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              {connectionMessage}
            </div>
          ) : null}
          {!secureModeReady && activeAttempt?.status === "in_progress" ? (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
              <p>Fullscreen must stay enabled for this secure interview.</p>
              <button
                type="button"
                onClick={enterSecureFullscreen}
                className="mt-3 rounded-2xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
              >
                Enter Full Screen
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur">
            {warningMessage ? (
              <div className="mb-4 rounded-2xl border border-amber-300/50 bg-amber-500/15 px-4 py-3 text-sm text-amber-100">
                {warningMessage}
              </div>
            ) : null}
            {activeAttempt?.status === "terminated" ? (
              <div>
                <h3 className="text-2xl font-semibold text-white">Interview terminated</h3>
                <p className="mt-3 text-sm text-slate-300">
                  {activeAttempt.terminationReason || "Closed due to repeated proctoring violations."}
                </p>
              </div>
            ) : unansweredQuestion ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">
                  Question {unansweredQuestion.position} of {activeAttempt?.questions?.length || 0}
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-white">{unansweredQuestion.prompt}</h3>
                <div className="mt-4 rounded-2xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-100">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold">Live voice interview</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-teal-200">
                        Voice status: {voiceStatus}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        speakQuestion(unansweredQuestion.prompt, setVoiceStatus, () => {
                          setAutoListenToken((value) => value + 1);
                        })
                      }
                      disabled={!interviewReady}
                      className="rounded-2xl bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-60"
                    >
                      Speak Question
                    </button>
                  </div>
                </div>
                <VoiceAnswerRecorder
                  disabled={busy || activeAttempt.status !== "in_progress" || !interviewReady}
                  onTranscriptChange={setResponseText}
                  setVoiceStatus={setVoiceStatus}
                  autoStartToken={autoListenToken}
                  onAutoSubmit={submitAnswer}
                  disabledMessage={!interviewReady ? "Enable fullscreen first to unlock voice recording." : ""}
                />
                <textarea
                  value={responseText}
                  onChange={(event) => setResponseText(event.target.value)}
                  rows={10}
                  disabled={!interviewReady}
                  className="mt-5 w-full rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-4 text-white outline-none focus:border-teal-400 disabled:opacity-60"
                  placeholder="Voice transcript appears here. You can edit it before submitting if needed."
                />
                <button
                  type="button"
                  disabled={busy || !responseText.trim() || !interviewReady}
                  onClick={submitAnswer}
                  className="mt-4 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60"
                >
                  {busy ? "Scoring response..." : "Submit Answer"}
                </button>
              </>
            ) : (
              <div>
                <h3 className="text-2xl font-semibold text-white">All questions answered</h3>
                <p className="mt-3 text-sm text-slate-300">
                  Finalize the interview to compute the overall score and recruiter recommendation.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <FaceMonitor activeAttempt={activeAttempt} onWarning={issueWarning} />
            <div className="space-y-3">
              {activeAttempt?.questions?.map((question) => (
                <div key={question.id} className="rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">Q{question.position}</p>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase text-slate-200">
                      {question.category}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-200">{question.prompt}</p>
                  {question.answer ? (
                    <div className="mt-4 rounded-2xl bg-slate-900/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">AI Feedback</p>
                      <p className="mt-2 text-sm text-slate-200">{question.answer.feedback}</p>
                      <p className="mt-3 text-sm font-semibold text-teal-300">Score: {question.answer.score}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {["completed", "terminated"].includes(activeAttempt?.status) ? (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard label="Overall Score" value={activeAttempt.overallScore} hint="latest attempt" />
              <StatCard label="Recommendation" value={activeAttempt.recommendation} hint="recruiter signal" />
              <StatCard label="Warnings" value={activeAttempt.warningCount} hint="secure proctoring" />
            </div>
            {activeAttempt.report ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-300">Score Report</p>
                <p className="mt-3 text-sm leading-6 text-slate-200">{activeAttempt.report.overallSummary}</p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <StatCard label="Technical" value={activeAttempt.report.technicalScore} hint="rubric" />
                  <StatCard label="Communication" value={activeAttempt.report.communicationScore} hint="rubric" />
                  <StatCard label="Problem Solving" value={activeAttempt.report.problemSolvingScore} hint="rubric" />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VoiceAnswerRecorder({
  disabled,
  onTranscriptChange,
  setVoiceStatus,
  autoStartToken,
  onAutoSubmit,
  disabledMessage = "",
}) {
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const transcriptBufferRef = useRef("");
  const autoSubmitRef = useRef(false);
  const autoSubmitTimerRef = useRef(null);
  const micStreamRef = useRef(null);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setVoiceStatus("Speech recognition unsupported");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("Listening for answer...");
    };

    recognition.onresult = (event) => {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          finalText += `${result[0].transcript} `;
        } else {
          interimText += result[0].transcript;
        }
      }

      setInterimTranscript(interimText);
      if (finalText.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalText}`.trim();
      }
      transcriptBufferRef.current = `${finalTranscriptRef.current} ${interimText}`.trim();
      onTranscriptChange(transcriptBufferRef.current);
    };

    recognition.onerror = (event) => {
      const errorCode = event?.error || "unknown";
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        setVoiceStatus("Microphone permission is blocked. Allow microphone access and try again.");
      } else if (errorCode === "no-speech") {
        setVoiceStatus("No speech heard. Try again and speak clearly into the microphone.");
      } else {
        setVoiceStatus("Voice capture error. You can still type your answer.");
      }
      setListening(false);
      autoSubmitRef.current = false;
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
      const finalTranscript = (transcriptBufferRef.current || finalTranscriptRef.current).trim();
      if (finalTranscript && autoSubmitRef.current) {
        autoSubmitRef.current = false;
        setVoiceStatus("Submitting voice answer...");
        onAutoSubmit(finalTranscript);
      } else if (finalTranscript) {
        setVoiceStatus("Voice answer captured. You can keep speaking or submit when ready.");
      } else {
        autoSubmitRef.current = false;
        setVoiceStatus("No voice answer detected");
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      recognition.stop();
    };
  }, [onAutoSubmit, onTranscriptChange, setVoiceStatus]);

  useEffect(() => {
    if (!autoStartToken || disabled || !recognitionRef.current) {
      return;
    }
    const timerId = window.setTimeout(() => {
      startListening(true);
    }, 250);
    return () => window.clearTimeout(timerId);
  }, [autoStartToken, disabled]);

  async function startListening(shouldAutoSubmit = false) {
    if (!recognitionRef.current || disabled) return;
    autoSubmitRef.current = shouldAutoSubmit;
    finalTranscriptRef.current = "";
    transcriptBufferRef.current = "";
    onTranscriptChange("");
    setInterimTranscript("");
    setVoiceStatus("Preparing microphone...");

    try {
      if (!micStreamRef.current) {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      recognitionRef.current.start();
    } catch (error) {
      autoSubmitRef.current = false;
      if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
        setVoiceStatus("Microphone permission is required to record your answer.");
      } else if (error?.name === "InvalidStateError") {
        setVoiceStatus("Microphone is already listening.");
      } else {
        setVoiceStatus("Microphone could not start. You can still type your answer.");
      }
    }
  }

  function stopListening() {
    const transcript = (transcriptBufferRef.current || finalTranscriptRef.current).trim();
    if (autoSubmitRef.current && transcript) {
      setVoiceStatus("Submitting voice answer...");
      onAutoSubmit(transcript);
      autoSubmitRef.current = false;
      recognitionRef.current?.stop();
      return;
    }
    recognitionRef.current?.stop();
  }

  useEffect(() => {
    if (!listening || !autoSubmitRef.current) {
      return undefined;
    }

    autoSubmitTimerRef.current = window.setTimeout(() => {
      if (!recognitionRef.current) {
        return;
      }
      setVoiceStatus("Finishing voice answer...");
      recognitionRef.current.stop();
    }, 90000);

    return () => {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    };
  }, [listening, onAutoSubmit, setVoiceStatus]);

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Student voice answer</p>
          <p className="mt-1 text-sm text-slate-600">
            Answer in voice. We transcribe it live before submission.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => startListening(false)}
            disabled={!supported || disabled || listening}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Start Voice Answer
          </button>
          <button
            type="button"
            onClick={stopListening}
            disabled={!listening}
            className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
          >
            Stop Recording
          </button>
        </div>
      </div>
      {!supported ? (
        <p className="mt-3 text-sm text-amber-700">
          This browser does not support speech recognition here. Typed answers still work, and Chrome usually gives the best voice-answer support.
        </p>
      ) : disabled && disabledMessage ? (
        <p className="mt-3 text-sm text-amber-700">{disabledMessage}</p>
      ) : interimTranscript ? (
        <p className="mt-3 text-sm italic text-slate-500">Listening: {interimTranscript}</p>
      ) : null}
    </div>
  );
}

async function speakQuestion(text, setVoiceStatus, onEnd) {
  if (!("speechSynthesis" in window)) {
    setVoiceStatus("Question audio unsupported");
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanQuestionForSpeech(text));
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.onstart = () => setVoiceStatus("AI interviewer speaking...");
  utterance.onend = () => {
    setVoiceStatus("Starting student voice capture...");
    onEnd?.();
  };
  utterance.onerror = () => {
    setVoiceStatus("Question audio unavailable, continue with typed or recorded answer.");
    onEnd?.();
  };

  const selectedVoice = pickInterviewVoice(await loadSpeechVoices(window.speechSynthesis));
  if (!selectedVoice) {
    setVoiceStatus("No natural interview voice found. Read the question on screen.");
    onEnd?.();
    return;
  }

  utterance.voice = selectedVoice;

  window.speechSynthesis.speak(utterance);
}

function cleanQuestionForSpeech(text) {
  return String(text || "").replace(/^\s*(medium|hard)\s*:\s*/i, "").trim();
}

function loadSpeechVoices(speechSynthesisInstance) {
  const available = speechSynthesisInstance.getVoices();
  if (available.length) {
    return Promise.resolve(available);
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      speechSynthesisInstance.onvoiceschanged = null;
      resolve(speechSynthesisInstance.getVoices());
    }, 1200);

    speechSynthesisInstance.onvoiceschanged = () => {
      window.clearTimeout(timeoutId);
      speechSynthesisInstance.onvoiceschanged = null;
      resolve(speechSynthesisInstance.getVoices());
    };
  });
}

function pickInterviewVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) {
    return null;
  }

  const candidates = voices.filter((voice) => /^en(-|_)/i.test(voice.lang || ""));
  const rankedMatchers = [
    /aria.*natural|jenny.*natural|guy.*natural|sara.*natural/i,
    /samantha|ava|allison|aria|jenny|daniel|moira/i,
    /natural|enhanced|premium/i,
  ];

  for (const matcher of rankedMatchers) {
    const match = candidates.find((voice) => matcher.test(voice.name || ""));
    if (match) {
      return match;
    }
  }

  return candidates.find((voice) => voice.localService && !/google us english/i.test(voice.name || "")) || null;
}

function FaceMonitor({ activeAttempt, onWarning }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const cooldownRef = useRef(0);
  const detectionRunningRef = useRef(false);
  const warningPendingRef = useRef(false);
  const consecutiveMultiFaceRef = useRef(0);
  const [status, setStatus] = useState("Camera starting...");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let timerId = null;
    let stopped = false;

    async function startMonitoring() {
      if (!activeAttempt || activeAttempt.status !== "in_progress") {
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        detectorRef.current = await loadFaceDetector();
        setSupported(true);
        setStatus(
          detectorRef.current.kind === "native"
            ? "Live proctoring active"
            : "Live proctoring active (browser compatibility mode)"
        );

        timerId = window.setInterval(async () => {
          if (
            !videoRef.current ||
            !detectorRef.current ||
            videoRef.current.readyState < 2 ||
            activeAttempt.status !== "in_progress" ||
            detectionRunningRef.current
          ) {
            return;
          }

          detectionRunningRef.current = true;
          try {
            const faces = await detectorRef.current.detect(videoRef.current);
            const confidentFaces = faces.filter((face) => {
              const box = face.boundingBox || face.box || {};
              const width =
                box.width ||
                (Array.isArray(face.topRight) && Array.isArray(face.topLeft) ? Math.abs(face.topRight[0] - face.topLeft[0]) : 0) ||
                (Array.isArray(face.bottomRight) && Array.isArray(face.topLeft) ? Math.abs(face.bottomRight[0] - face.topLeft[0]) : 0);
              const height =
                box.height ||
                (Array.isArray(face.bottomLeft) && Array.isArray(face.topLeft) ? Math.abs(face.bottomLeft[1] - face.topLeft[1]) : 0) ||
                (Array.isArray(face.bottomRight) && Array.isArray(face.topLeft) ? Math.abs(face.bottomRight[1] - face.topLeft[1]) : 0);
              return width >= 90 && height >= 90;
            });

            if (confidentFaces.length > 1) {
              consecutiveMultiFaceRef.current += 1;
              const now = Date.now();
              if (
                consecutiveMultiFaceRef.current >= 2 &&
                now - cooldownRef.current > 12000 &&
                !warningPendingRef.current
              ) {
                warningPendingRef.current = true;
                cooldownRef.current = now;
                setStatus(`Multiple faces detected (${confidentFaces.length})`);
                await onWarning("Multiple faces detected in camera view");
                warningPendingRef.current = false;
              }
            } else if (confidentFaces.length === 1) {
              consecutiveMultiFaceRef.current = 0;
              setStatus("Single face verified");
            } else {
              consecutiveMultiFaceRef.current = 0;
              setStatus("No face clearly visible");
            }
          } catch (_error) {
            warningPendingRef.current = false;
            setStatus("Camera monitor active");
          } finally {
            detectionRunningRef.current = false;
          }
        }, 3500);
      } catch (error) {
        setSupported(false);
        if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
          setStatus("Camera access is required for proctoring.");
        } else {
          setStatus("Automatic face detection is unavailable right now.");
        }
      }
    }

    startMonitoring();

    return () => {
      stopped = true;
      if (timerId) {
        window.clearInterval(timerId);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [activeAttempt?.id, activeAttempt?.status, onWarning]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Live Proctoring</p>
      <div className="mt-4 overflow-hidden rounded-3xl bg-slate-950">
        <video ref={videoRef} autoPlay muted playsInline className="h-64 w-full object-cover" />
      </div>
      <div className="mt-4 space-y-2 text-sm text-slate-600">
        <p>Status: {status}</p>
        <p>Warnings: {activeAttempt?.warningCount || 0}/3</p>
        {!supported ? (
          <p className="text-amber-700">
            Automatic multi-face detection is unavailable in this browser or device right now.
          </p>
        ) : null}
      </div>
    </div>
  );
}
