from flask import Blueprint, jsonify, request

from ..auth import current_user, role_required
from ..extensions import db
from ..models import Application, InterviewAttempt, InterviewStatus, Job, JobStatus, UserRole

recruiter_bp = Blueprint("recruiter", __name__)


@recruiter_bp.get("/dashboard")
@role_required(UserRole.RECRUITER.value)
def dashboard():
    user = current_user()
    jobs = Job.query.filter_by(recruiter_id=user.id).order_by(Job.created_at.desc()).all()
    job_ids = [job.id for job in jobs]
    applications = Application.query.filter(Application.job_id.in_(job_ids)).all() if job_ids else []
    attempts = InterviewAttempt.query.filter(InterviewAttempt.job_id.in_(job_ids)).all() if job_ids else []
    completed = [attempt for attempt in attempts if attempt.status == InterviewStatus.COMPLETED.value]
    average_score = round(sum(item.overall_score for item in completed) / len(completed), 1) if completed else 0

    return jsonify(
        {
            "summary": {
                "jobs": len(jobs),
                "activeJobs": len([job for job in jobs if job.status == JobStatus.ACTIVE.value]),
                "applications": len(applications),
                "completedInterviews": len(completed),
                "averageInterviewScore": average_score,
            },
            "jobs": [job.to_dict() for job in jobs],
            "recentCandidates": [_candidate_row(application) for application in applications[:10]],
        }
    )


@recruiter_bp.get("/jobs")
@role_required(UserRole.RECRUITER.value)
def list_recruiter_jobs():
    user = current_user()
    jobs = Job.query.filter_by(recruiter_id=user.id).order_by(Job.created_at.desc()).all()
    return jsonify({"jobs": [job.to_dict() for job in jobs]})


@recruiter_bp.post("/jobs")
@role_required(UserRole.RECRUITER.value)
def create_job():
    user = current_user()
    data = request.get_json() or {}
    required = ["title", "description"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({"message": f"Missing fields: {', '.join(missing)}"}), 400

    requirements = data.get("requirements", [])
    if isinstance(requirements, list):
        requirements = ",".join([item.strip() for item in requirements if item.strip()])

    job = Job(
        recruiter_id=user.id,
        title=data["title"].strip(),
        department=data.get("department", ""),
        location=data.get("location", ""),
        description=data["description"].strip(),
        requirements=requirements,
        interview_focus=data.get("interviewFocus", ""),
        status=data.get("status", JobStatus.ACTIVE.value),
    )
    db.session.add(job)
    db.session.commit()
    return jsonify({"job": job.to_dict()}), 201


@recruiter_bp.get("/jobs/<int:job_id>/candidates")
@role_required(UserRole.RECRUITER.value)
def job_candidates(job_id: int):
    user = current_user()
    job = Job.query.get_or_404(job_id)
    if job.recruiter_id != user.id:
        return jsonify({"message": "Forbidden"}), 403

    applications = Application.query.filter_by(job_id=job.id).order_by(Application.created_at.desc()).all()
    candidates = [_candidate_row(application) for application in applications]
    return jsonify({"job": job.to_dict(), "candidates": candidates})


def _candidate_row(application: Application):
    attempts = sorted(
        application.attempts,
        key=lambda item: item.completed_at or item.created_at,
        reverse=True,
    )
    latest_attempt = attempts[0] if attempts else None
    student = application.student
    profile = student.student_profile.to_dict() if student and student.student_profile else {}
    return {
        "applicationId": application.id,
        "status": application.status,
        "createdAt": application.created_at.isoformat(),
        "student": {
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "headline": profile.get("headline", ""),
            "skills": profile.get("skills", []),
            "targetRole": profile.get("target_role", ""),
        },
        "latestInterview": latest_attempt.to_dict() if latest_attempt else None,
    }
