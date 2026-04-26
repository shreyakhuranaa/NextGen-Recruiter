import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";

export function StudentDashboard() {
  const { user } = useAuth();
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

  async function load() {
    const [dashboardResponse, jobsResponse] = await Promise.all([
      api.get("/student/dashboard"),
      api.get("/jobs"),
    ]);
    setDashboard(dashboardResponse.data);
    setJobs(jobsResponse.data.jobs);
  }

  useEffect(() => {
    load();
  }, []);

  const unansweredQuestion = useMemo(
    () => activeAttempt?.questions?.find((question) => !question.answer) || null,
    [activeAttempt]
  );

  useEffect(() => {
    if (!unansweredQuestion || activeAttempt?.status !== "in_progress") {
      return;
    }
    speakQuestion(unansweredQuestion.prompt, setVoiceStatus, () => {
      setAutoListenToken((value) => value + 1);
    });
  }, [unansweredQuestion?.id, activeAttempt?.status]);

  async function apply(jobId) {
    await api.post(`/jobs/${jobId}/apply`);
    await load();
  }

  async function startInterview(jobId) {
    try {
      const response = await api.post(`/jobs/${jobId}/interviews/start`);
      setActiveAttempt(response.data.attempt);
      setResponseText("");
      setWarningMessage("");
      setResumeMessage("");
      await load();
    } catch (error) {
      setResumeMessage(error.response?.data?.message || "Unable to start the interview.");
    }
  }

  async function submitAnswer(transcriptOverride) {
    const finalAnswer = typeof transcriptOverride === "string" ? transcriptOverride.trim() : responseText.trim();
    if (!unansweredQuestion || !finalAnswer) return;
    setBusy(true);
    try {
      await api.post(`/student/interviews/${activeAttempt.id}/answers`, {
        questionId: unansweredQuestion.id,
        responseText: finalAnswer,
      });
      const refreshed = await api.get(`/student/interviews/${activeAttempt.id}`);
      setActiveAttempt(refreshed.data.attempt);
      setResponseText("");
    } finally {
      setBusy(false);
    }
  }

  async function completeInterview() {
    if (!activeAttempt) return;
    const response = await api.post(`/student/interviews/${activeAttempt.id}/complete`);
    setActiveAttempt(response.data.attempt);
    await load();
  }

  const issueWarning = useCallback(async (reason) => {
    if (!activeAttempt || activeAttempt.status !== "in_progress") return;
    const response = await api.post(`/student/interviews/${activeAttempt.id}/proctor-warning`, {
      reason,
    });
    setActiveAttempt(response.data.attempt);
    if (response.data.terminated) {
      setWarningMessage("Interview closed after 3 proctoring warnings.");
      await load();
      return;
    }
    setWarningMessage(`Warning ${response.data.attempt.warningCount}/3: ${reason}`);
  }, [activeAttempt]);

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

  if (!dashboard) {
    return <div className="rounded-3xl bg-white p-6 shadow-panel">Loading dashboard...</div>;
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

function VoiceAnswerRecorder({
  disabled,
  onTranscriptChange,
  setVoiceStatus,
  autoStartToken,
  onAutoSubmit,
}) {
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const autoSubmitRef = useRef(false);
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
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("Listening for answer...");
    };

    recognition.onresult = (event) => {
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
        onTranscriptChange(finalTranscriptRef.current);
      }
    };

    recognition.onerror = () => {
      setVoiceStatus("Voice capture error. You can still type your answer.");
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
      const finalTranscript = finalTranscriptRef.current.trim();
      if (finalTranscript && autoSubmitRef.current) {
        autoSubmitRef.current = false;
        setVoiceStatus("Submitting voice answer...");
        onAutoSubmit(finalTranscript);
      } else if (finalTranscript) {
        setVoiceStatus("Submitting voice answer...");
      } else {
        autoSubmitRef.current = false;
        setVoiceStatus("No voice answer detected");
      }
    };

    recognitionRef.current = recognition;

    return () => {
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

  function startListening(shouldAutoSubmit = false) {
    if (!recognitionRef.current || disabled) return;
    autoSubmitRef.current = shouldAutoSubmit;
    finalTranscriptRef.current = "";
    onTranscriptChange("");
    setInterimTranscript("");
    setVoiceStatus("Preparing microphone...");
    recognitionRef.current.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

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
          This browser does not support speech recognition, so the interview can still continue with typed answers.
        </p>
      ) : interimTranscript ? (
        <p className="mt-3 text-sm italic text-slate-500">Listening: {interimTranscript}</p>
      ) : null}
    </div>
  );
}

function speakQuestion(text, setVoiceStatus, onEnd) {
  if (!("speechSynthesis" in window)) {
    setVoiceStatus("Question audio unsupported");
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.onstart = () => setVoiceStatus("AI interviewer speaking...");
  utterance.onend = () => {
    setVoiceStatus("Starting student voice capture...");
    onEnd?.();
  };
  utterance.onerror = () => setVoiceStatus("Question audio failed");

  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find((voice) => /samantha|karen|aria|jenny|google us english/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === "en-US") ||
    null;

  window.speechSynthesis.speak(utterance);
}

function FaceMonitor({ activeAttempt, onWarning }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const cooldownRef = useRef(0);
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

        if (!("FaceDetector" in window)) {
          setSupported(false);
          setStatus("Face detection is not supported in this browser.");
          return;
        }

        detectorRef.current = new window.FaceDetector({
          fastMode: true,
          maxDetectedFaces: 5,
        });
        setStatus("Live proctoring active");

        timerId = window.setInterval(async () => {
          if (
            !videoRef.current ||
            !detectorRef.current ||
            videoRef.current.readyState < 2 ||
            activeAttempt.status !== "in_progress"
          ) {
            return;
          }

          try {
            const faces = await detectorRef.current.detect(videoRef.current);
            if (faces.length > 1) {
              const now = Date.now();
              if (now - cooldownRef.current > 6000) {
                cooldownRef.current = now;
                setStatus(`Multiple faces detected (${faces.length})`);
                await onWarning("Multiple faces detected in camera view");
              }
            } else if (faces.length === 1) {
              setStatus("Single face verified");
            } else {
              setStatus("No face clearly visible");
            }
          } catch (_error) {
            setStatus("Camera monitor active");
          }
        }, 3500);
      } catch (_error) {
        setStatus("Camera access is required for proctoring.");
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
            This browser does not support the FaceDetector API, so automatic multi-face enforcement is unavailable here.
          </p>
        ) : null}
      </div>
    </div>
  );
}
