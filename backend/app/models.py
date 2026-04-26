from datetime import datetime
from enum import Enum

from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


class UserRole(str, Enum):
    STUDENT = "student"
    RECRUITER = "recruiter"


class JobStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    CLOSED = "closed"


class InterviewStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    TERMINATED = "terminated"


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    student_profile = db.relationship("StudentProfile", back_populates="user", uselist=False)
    recruiter_profile = db.relationship(
        "RecruiterProfile", back_populates="user", uselist=False
    )
    resume = db.relationship("StudentResume", back_populates="user", uselist=False)
    jobs = db.relationship("Job", back_populates="recruiter", lazy=True)
    applications = db.relationship("Application", back_populates="student", lazy=True)
    attempts = db.relationship("InterviewAttempt", back_populates="student", lazy=True)

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
        }


class StudentProfile(db.Model):
    __tablename__ = "student_profiles"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, unique=True)
    headline = db.Column(db.String(255), default="")
    university = db.Column(db.String(255), default="")
    skills = db.Column(db.Text, default="")
    target_role = db.Column(db.String(255), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship("User", back_populates="student_profile")

    def to_dict(self):
        return {
            "headline": self.headline,
            "university": self.university,
            "skills": [skill.strip() for skill in self.skills.split(",") if skill.strip()],
            "target_role": self.target_role,
        }


class RecruiterProfile(db.Model):
    __tablename__ = "recruiter_profiles"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, unique=True)
    company = db.Column(db.String(255), default="")
    title = db.Column(db.String(255), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship("User", back_populates="recruiter_profile")

    def to_dict(self):
        return {"company": self.company, "title": self.title}


class StudentResume(db.Model):
    __tablename__ = "student_resumes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, unique=True)
    filename = db.Column(db.String(255), default="")
    raw_text = db.Column(db.Text, default="")
    parsed_json = db.Column(db.Text, default="")
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship("User", back_populates="resume")

    def to_dict(self):
        import json

        parsed = {}
        if self.parsed_json:
            try:
                parsed = json.loads(self.parsed_json)
            except Exception:
                parsed = {}
        return {
            "filename": self.filename,
            "uploadedAt": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "parsed": parsed,
        }


class Job(db.Model):
    __tablename__ = "jobs"

    id = db.Column(db.Integer, primary_key=True)
    recruiter_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    department = db.Column(db.String(120), default="")
    location = db.Column(db.String(120), default="")
    description = db.Column(db.Text, nullable=False)
    requirements = db.Column(db.Text, default="")
    interview_focus = db.Column(db.Text, default="")
    status = db.Column(db.String(20), default=JobStatus.ACTIVE.value, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    recruiter = db.relationship("User", back_populates="jobs")
    applications = db.relationship("Application", back_populates="job", lazy=True)
    attempts = db.relationship("InterviewAttempt", back_populates="job", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "department": self.department,
            "location": self.location,
            "description": self.description,
            "requirements": [item.strip() for item in self.requirements.split(",") if item.strip()],
            "interviewFocus": self.interview_focus,
            "status": self.status,
            "createdAt": self.created_at.isoformat(),
            "recruiter": self.recruiter.to_dict() if self.recruiter else None,
        }


class Application(db.Model):
    __tablename__ = "applications"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False)
    status = db.Column(db.String(40), default="applied", nullable=False)
    notes = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    student = db.relationship("User", back_populates="applications")
    job = db.relationship("Job", back_populates="applications")
    attempts = db.relationship("InterviewAttempt", back_populates="application", lazy=True)

    __table_args__ = (db.UniqueConstraint("student_id", "job_id", name="uq_application"),)

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "notes": self.notes,
            "createdAt": self.created_at.isoformat(),
            "job": self.job.to_dict() if self.job else None,
        }


class InterviewAttempt(db.Model):
    __tablename__ = "interview_attempts"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False)
    application_id = db.Column(db.Integer, db.ForeignKey("applications.id"), nullable=True)
    status = db.Column(db.String(20), default=InterviewStatus.IN_PROGRESS.value, nullable=False)
    overall_score = db.Column(db.Float, default=0)
    recommendation = db.Column(db.String(80), default="Pending")
    strengths = db.Column(db.Text, default="")
    growth_areas = db.Column(db.Text, default="")
    warning_count = db.Column(db.Integer, default=0, nullable=False)
    termination_reason = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    completed_at = db.Column(db.DateTime, nullable=True)

    student = db.relationship("User", back_populates="attempts")
    job = db.relationship("Job", back_populates="attempts")
    application = db.relationship("Application", back_populates="attempts")
    questions = db.relationship(
        "InterviewQuestion", back_populates="attempt", lazy=True, cascade="all, delete-orphan"
    )
    answers = db.relationship(
        "AttemptAnswer", back_populates="attempt", lazy=True, cascade="all, delete-orphan"
    )
    report = db.relationship(
        "InterviewReport", back_populates="attempt", uselist=False, cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "overallScore": round(self.overall_score or 0, 1),
            "recommendation": self.recommendation,
            "strengths": [item.strip() for item in self.strengths.split("|") if item.strip()],
            "growthAreas": [item.strip() for item in self.growth_areas.split("|") if item.strip()],
            "warningCount": self.warning_count or 0,
            "terminationReason": self.termination_reason or "",
            "createdAt": self.created_at.isoformat(),
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "job": self.job.to_dict() if self.job else None,
            "report": self.report.to_dict() if self.report else None,
        }


class InterviewQuestion(db.Model):
    __tablename__ = "interview_questions"

    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.Integer, db.ForeignKey("interview_attempts.id"), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(80), default="technical")
    position = db.Column(db.Integer, nullable=False)

    attempt = db.relationship("InterviewAttempt", back_populates="questions")
    answer = db.relationship("AttemptAnswer", back_populates="question", uselist=False)

    def to_dict(self):
        return {
            "id": self.id,
            "prompt": self.prompt,
            "category": self.category,
            "position": self.position,
            "answer": self.answer.to_dict() if self.answer else None,
        }


class AttemptAnswer(db.Model):
    __tablename__ = "attempt_answers"

    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.Integer, db.ForeignKey("interview_attempts.id"), nullable=False)
    question_id = db.Column(db.Integer, db.ForeignKey("interview_questions.id"), nullable=False)
    response_text = db.Column(db.Text, nullable=False)
    score = db.Column(db.Float, default=0)
    feedback = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    attempt = db.relationship("InterviewAttempt", back_populates="answers")
    question = db.relationship("InterviewQuestion", back_populates="answer")

    __table_args__ = (db.UniqueConstraint("attempt_id", "question_id", name="uq_attempt_answer"),)

    def to_dict(self):
        return {
            "id": self.id,
            "responseText": self.response_text,
            "score": round(self.score or 0, 1),
            "feedback": self.feedback,
            "createdAt": self.created_at.isoformat(),
        }


class InterviewReport(db.Model):
    __tablename__ = "interview_reports"

    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.Integer, db.ForeignKey("interview_attempts.id"), nullable=False, unique=True)
    overall_summary = db.Column(db.Text, default="")
    technical_score = db.Column(db.Float, default=0)
    communication_score = db.Column(db.Float, default=0)
    problem_solving_score = db.Column(db.Float, default=0)
    strengths = db.Column(db.Text, default="")
    growth_areas = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    attempt = db.relationship("InterviewAttempt", back_populates="report")

    def to_dict(self):
        return {
            "overallSummary": self.overall_summary,
            "technicalScore": round(self.technical_score or 0, 1),
            "communicationScore": round(self.communication_score or 0, 1),
            "problemSolvingScore": round(self.problem_solving_score or 0, 1),
            "strengths": [item.strip() for item in self.strengths.split("|") if item.strip()],
            "growthAreas": [item.strip() for item in self.growth_areas.split("|") if item.strip()],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
