import json
from datetime import datetime

from flask import Blueprint, jsonify, request

from ..auth import current_user, role_required
from ..extensions import db, limiter
from ..models import (
    AttemptAnswer,
    InterviewAttempt,
    InterviewQuestion,
    InterviewReport,
    InterviewStatus,
    StudentResume,
    UserRole,
)
from ..services.ai_evaluator import evaluate_answer, summarize_attempt_with_ai
from ..services.interview_pipeline import build_score_report
from ..services.resume_pipeline import dump_parsed_resume, parse_resume_file

student_bp = Blueprint("student", __name__)


@student_bp.get("/dashboard")
@role_required(UserRole.STUDENT.value)
def dashboard():
    user = current_user()
    attempts = (
        InterviewAttempt.query.filter_by(student_id=user.id)
        .order_by(InterviewAttempt.created_at.desc())
        .all()
    )
    applications = [application.to_dict() for application in user.applications]
    completed_scores = [attempt.overall_score for attempt in attempts if attempt.status == InterviewStatus.COMPLETED.value]
    average_score = round(sum(completed_scores) / len(completed_scores), 1) if completed_scores else 0

    return jsonify(
        {
            "summary": {
                "applications": len(applications),
                "interviewsTaken": len(attempts),
                "averageScore": average_score,
                "bestScore": max(completed_scores) if completed_scores else 0,
            },
            "applications": applications,
            "attempts": [_serialize_attempt(attempt) for attempt in attempts[:10]],
            "resume": user.resume.to_dict() if user.resume else None,
        }
    )


@student_bp.post("/resume")
@role_required(UserRole.STUDENT.value)
@limiter.limit("10 per minute")
def upload_resume():
    user = current_user()
    resume_file = request.files.get("resume")
    if not resume_file or not resume_file.filename:
        return jsonify({"message": "Resume file is required"}), 400

    try:
        raw_text, parsed = parse_resume_file(resume_file)
    except Exception as exc:
        return jsonify({"message": str(exc)}), 400

    record = StudentResume.query.filter_by(user_id=user.id).first()
    if not record:
        record = StudentResume(user_id=user.id)
        db.session.add(record)

    record.filename = resume_file.filename
    record.raw_text = raw_text
    record.parsed_json = dump_parsed_resume(parsed)
    record.uploaded_at = datetime.utcnow()
    db.session.commit()

    return jsonify({"resume": record.to_dict()})


@student_bp.get("/interviews/<int:attempt_id>")
@role_required(UserRole.STUDENT.value)
def get_attempt(attempt_id: int):
    user = current_user()
    attempt = InterviewAttempt.query.get_or_404(attempt_id)
    if attempt.student_id != user.id:
        return jsonify({"message": "Forbidden"}), 403
    return jsonify({"attempt": _serialize_attempt(attempt)})


@student_bp.post("/interviews/<int:attempt_id>/answers")
@role_required(UserRole.STUDENT.value)
@limiter.limit("30 per minute")
def submit_answer(attempt_id: int):
    user = current_user()
    attempt = InterviewAttempt.query.get_or_404(attempt_id)
    if attempt.student_id != user.id:
        return jsonify({"message": "Forbidden"}), 403
    if attempt.status != InterviewStatus.IN_PROGRESS.value:
        return jsonify({"message": "Interview is no longer active"}), 400

    data = request.get_json() or {}
    question_id = data.get("questionId")
    response_text = (data.get("responseText") or "").strip()
    if not question_id or not response_text:
        return jsonify({"message": "questionId and responseText are required"}), 400

    question = InterviewQuestion.query.filter_by(id=question_id, attempt_id=attempt.id).first()
    if not question:
        return jsonify({"message": "Question not found"}), 404

    existing = AttemptAnswer.query.filter_by(attempt_id=attempt.id, question_id=question.id).first()
    if existing:
        return jsonify({"message": "Question already answered"}), 409

    context_keywords = _context_keywords(attempt)
    evaluation = evaluate_answer(question.prompt, response_text, context_keywords)
    answer = AttemptAnswer(
        attempt_id=attempt.id,
        question_id=question.id,
        response_text=response_text,
        score=evaluation["score"],
        feedback=evaluation["feedback"],
    )
    db.session.add(answer)
    db.session.commit()

    return jsonify(
        {
            "answer": answer.to_dict(),
            "analytics": {
                "wordCount": evaluation["wordCount"],
                "relevanceScore": evaluation.get("relevanceScore", 0),
                "depthScore": evaluation.get("depthScore", 0),
                "clarityScore": evaluation.get("clarityScore", 0),
                "strengths": evaluation.get("strengths", []),
                "growthAreas": evaluation.get("growthAreas", []),
            },
        }
    ), 201


@student_bp.post("/interviews/<int:attempt_id>/complete")
@role_required(UserRole.STUDENT.value)
@limiter.limit("10 per minute")
def complete_attempt(attempt_id: int):
    user = current_user()
    attempt = InterviewAttempt.query.get_or_404(attempt_id)
    if attempt.student_id != user.id:
        return jsonify({"message": "Forbidden"}), 403

    if attempt.status == InterviewStatus.TERMINATED.value:
        return jsonify({"message": "Interview was terminated"}), 400

    answer_payloads = [
        {
            "question": answer.question.prompt if answer.question else "",
            "category": answer.question.category if answer.question else "",
            "answer": answer.response_text or "",
            "score": answer.score or 0,
            "feedback": answer.feedback or "",
        }
        for answer in sorted(
            attempt.answers, key=lambda item: item.question.position if item.question else item.id
        )
    ]
    summary = summarize_attempt_with_ai(attempt, answer_payloads) if answer_payloads else build_score_report(attempt, attempt.answers)
    attempt.status = InterviewStatus.COMPLETED.value
    attempt.completed_at = datetime.utcnow()
    attempt.overall_score = summary["overallScore"]
    attempt.recommendation = summary["recommendation"]
    attempt.strengths = "|".join(summary["strengths"])
    attempt.growth_areas = "|".join(summary["growthAreas"])
    report = attempt.report
    if not report:
        report = InterviewReport(attempt_id=attempt.id)
        db.session.add(report)
    report.overall_summary = summary["overallSummary"]
    report.technical_score = summary["technicalScore"]
    report.communication_score = summary["communicationScore"]
    report.problem_solving_score = summary["problemSolvingScore"]
    report.strengths = "|".join(summary["strengths"])
    report.growth_areas = "|".join(summary["growthAreas"])
    if attempt.application:
        attempt.application.status = "interview_completed"
    db.session.commit()

    return jsonify({"attempt": _serialize_attempt(attempt)})


@student_bp.post("/interviews/<int:attempt_id>/proctor-warning")
@role_required(UserRole.STUDENT.value)
@limiter.limit("30 per minute")
def issue_proctor_warning(attempt_id: int):
    user = current_user()
    attempt = InterviewAttempt.query.get_or_404(attempt_id)
    if attempt.student_id != user.id:
        return jsonify({"message": "Forbidden"}), 403
    if attempt.status != InterviewStatus.IN_PROGRESS.value:
        return jsonify({"message": "Interview is no longer active"}), 400

    data = request.get_json() or {}
    reason = (data.get("reason") or "Multiple faces detected").strip()
    attempt.warning_count = (attempt.warning_count or 0) + 1

    terminated = attempt.warning_count >= 3
    if terminated:
        attempt.status = InterviewStatus.TERMINATED.value
        attempt.completed_at = datetime.utcnow()
        attempt.recommendation = "Closed by Proctoring"
        attempt.termination_reason = reason
        if attempt.application:
            attempt.application.status = "terminated_due_to_proctoring"

    db.session.commit()
    return jsonify(
        {
            "attempt": _serialize_attempt(attempt),
            "warningIssued": True,
            "terminated": terminated,
        }
    )


def _context_keywords(attempt: InterviewAttempt):
    keywords = [item.strip() for item in (attempt.job.requirements or "").split(",") if item.strip()]
    if attempt.student and attempt.student.resume and attempt.student.resume.parsed_json:
        try:
            parsed = json.loads(attempt.student.resume.parsed_json)
            keywords.extend(parsed.get("skills", [])[:10])
        except Exception:
            pass
    return keywords


def _serialize_attempt(attempt: InterviewAttempt):
    return {
        **attempt.to_dict(),
        "questions": [
            question.to_dict()
            for question in sorted(attempt.questions, key=lambda item: item.position)
        ],
        "answers": [
            answer.to_dict()
            for answer in sorted(
                attempt.answers, key=lambda item: item.question.position if item.question else item.id
            )
        ],
    }
