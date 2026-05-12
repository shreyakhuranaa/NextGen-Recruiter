from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from ..auth import current_user
from ..extensions import db, limiter
from ..models import (
    Application,
    InterviewAttempt,
    InterviewQuestion,
    InterviewStatus,
    Job,
    JobStatus,
    StudentResume,
    UserRole,
)
from ..services.interview_pipeline import generate_questions_from_scratch

jobs_bp = Blueprint("jobs", __name__)


@jobs_bp.get("")
def list_jobs():
    jobs = Job.query.filter(Job.status != JobStatus.CLOSED.value).order_by(Job.created_at.desc())
    return jsonify({"jobs": [job.to_dict() for job in jobs]})


@jobs_bp.post("/<int:job_id>/apply")
@jwt_required()
@limiter.limit("15 per minute")
def apply(job_id: int):
    user = current_user()
    if not user or user.role != UserRole.STUDENT.value:
        return jsonify({"message": "Students only"}), 403

    job = Job.query.get_or_404(job_id)
    application = Application.query.filter_by(student_id=user.id, job_id=job_id).first()
    if application:
        return jsonify({"application": application.to_dict(), "message": "Already applied"})

    application = Application(student_id=user.id, job_id=job_id)
    db.session.add(application)
    db.session.commit()
    return jsonify({"application": application.to_dict()}), 201


@jobs_bp.post("/<int:job_id>/interviews/start")
@jwt_required()
@limiter.limit("10 per minute")
def start_interview(job_id: int):
    user = current_user()
    if not user or user.role != UserRole.STUDENT.value:
        return jsonify({"message": "Students only"}), 403

    job = Job.query.get_or_404(job_id)
    application = Application.query.filter_by(student_id=user.id, job_id=job_id).first()
    resume = StudentResume.query.filter_by(user_id=user.id).first()
    if not resume or not resume.parsed_json:
        return jsonify({"message": "Upload and parse a resume before starting the interview."}), 400

    existing_attempt = (
        InterviewAttempt.query.filter_by(
            student_id=user.id,
            job_id=job.id,
            status=InterviewStatus.IN_PROGRESS.value,
        )
        .order_by(InterviewAttempt.created_at.desc())
        .first()
    )
    if existing_attempt:
        return jsonify({"attempt": _serialize_attempt(existing_attempt), "resumed": True}), 200

    attempt = InterviewAttempt(
        student_id=user.id,
        job_id=job.id,
        application_id=application.id if application else None,
        status=InterviewStatus.IN_PROGRESS.value,
    )
    db.session.add(attempt)
    db.session.flush()

    import json

    generated = generate_questions_from_scratch(job, json.loads(resume.parsed_json), count=10)
    for index, item in enumerate(generated, start=1):
        db.session.add(
            InterviewQuestion(
                attempt_id=attempt.id,
                prompt=item["prompt"],
                category=item.get("category", "technical"),
                position=index,
            )
        )

    db.session.commit()
    return jsonify({"attempt": _serialize_attempt(attempt)}), 201


def _serialize_attempt(attempt: InterviewAttempt):
    return {
        **attempt.to_dict(),
        "questions": [
            question.to_dict()
            for question in sorted(attempt.questions, key=lambda item: item.position)
        ],
    }


def _split_list(text: str):
    return [item.strip() for item in (text or "").split(",") if item.strip()]
