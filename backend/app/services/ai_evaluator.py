import json
import logging

from flask import current_app

from .interview_engine import build_question_set, score_answer, summarize_attempt

log = logging.getLogger(__name__)

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


QUESTION_SCHEMA = {
    "name": "interview_questions",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string"},
                        "category": {"type": "string"},
                    },
                    "required": ["prompt", "category"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["questions"],
        "additionalProperties": False,
    },
}

ANSWER_SCHEMA = {
    "name": "answer_evaluation",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "score": {"type": "number"},
            "feedback": {"type": "string"},
            "strengths": {"type": "array", "items": {"type": "string"}},
            "growthAreas": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["score", "feedback", "strengths", "growthAreas"],
        "additionalProperties": False,
    },
}

SUMMARY_SCHEMA = {
    "name": "attempt_summary",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "overallScore": {"type": "number"},
            "recommendation": {"type": "string"},
            "strengths": {"type": "array", "items": {"type": "string"}},
            "growthAreas": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["overallScore", "recommendation", "strengths", "growthAreas"],
        "additionalProperties": False,
    },
}


def generate_questions(job_title: str, requirements: list[str], interview_focus: str, count: int = 5):
    fallback_prompts = build_question_set(job_title, requirements, count=count)
    fallback = [
        {
            "prompt": prompt,
            "category": "technical" if index < 3 else "behavioral",
        }
        for index, prompt in enumerate(fallback_prompts)
    ]
    client = _client()
    if not client:
        return fallback

    try:
        response = client.responses.create(
            model=current_app.config["OPENAI_MODEL"],
            input=[
                {
                    "role": "system",
                    "content": "Create concise, role-relevant interview questions for software hiring.",
                },
                {
                    "role": "user",
                    "content": (
                        f"Generate {count} JSON interview questions.\n"
                        f"Job title: {job_title}\n"
                        f"Requirements: {', '.join(requirements) or 'General software engineering'}\n"
                        f"Interview focus: {interview_focus or 'General engineering performance'}\n"
                        "Return a balanced mix of technical and behavioral questions."
                    ),
                },
            ],
            text={"format": {"type": "json_schema", **QUESTION_SCHEMA}},
        )
        parsed = json.loads(response.output_text)
        if parsed.get("questions"):
            return parsed["questions"][:count]
    except Exception as exc:  # pragma: no cover
        log.warning("Question generation fell back to heuristic prompts: %s", exc)
    return fallback


def evaluate_answer(question: str, answer: str, requirements: list[str]):
    fallback = score_answer(question, answer, requirements)
    fallback["strengths"] = _default_strengths(fallback["score"])
    fallback["growthAreas"] = _default_growth_areas(fallback["score"])
    client = _client()
    if not client:
        return fallback

    try:
        response = client.responses.create(
            model=current_app.config["OPENAI_MODEL"],
            input=[
                {
                    "role": "system",
                    "content": "Evaluate a software interview answer and return strict JSON.",
                },
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\n"
                        f"Candidate answer: {answer}\n"
                        f"Target requirements: {', '.join(requirements) or 'General software engineering'}\n"
                        "Return score, concise feedback, strengths, and growth areas."
                    ),
                },
            ],
            text={"format": {"type": "json_schema", **ANSWER_SCHEMA}},
        )
        parsed = json.loads(response.output_text)
        parsed["score"] = round(float(parsed.get("score", fallback["score"])), 1)
        parsed["wordCount"] = fallback["wordCount"]
        parsed["matchedRequirements"] = fallback["matchedRequirements"]
        return parsed
    except Exception as exc:  # pragma: no cover
        log.warning("Answer evaluation fell back to heuristic scoring: %s", exc)
        return fallback


def summarize_attempt_with_ai(answer_payloads: list[dict]):
    fallback = summarize_attempt([item.get("score", 0) for item in answer_payloads])
    client = _client()
    if not client or not answer_payloads:
        return fallback

    try:
        response = client.responses.create(
            model=current_app.config["OPENAI_MODEL"],
            input=[
                {
                    "role": "system",
                    "content": "Summarize interview performance for recruiters and return strict JSON.",
                },
                {
                    "role": "user",
                    "content": f"Summarize these scored answers: {json.dumps(answer_payloads)}",
                },
            ],
            text={"format": {"type": "json_schema", **SUMMARY_SCHEMA}},
        )
        parsed = json.loads(response.output_text)
        parsed["overallScore"] = round(float(parsed.get("overallScore", fallback["overallScore"])), 1)
        return parsed
    except Exception as exc:  # pragma: no cover
        log.warning("Attempt summarization fell back to heuristic summary: %s", exc)
        return fallback


def _client():
    api_key = current_app.config.get("OPENAI_API_KEY")
    if not api_key or OpenAI is None:
        return None
    return OpenAI(api_key=api_key)


def _default_strengths(score: float):
    if score >= 80:
        return [
            "Clear relevance to the target role",
            "Strong technical framing and communication",
        ]
    if score >= 60:
        return ["Reasonable command of the topic", "Shows practical implementation awareness"]
    return ["Demonstrates baseline familiarity with the topic"]


def _default_growth_areas(score: float):
    if score >= 80:
        return ["Go deeper on tradeoffs, failure modes, and operational constraints"]
    if score >= 60:
        return ["Use more concrete examples and measurable outcomes"]
    return ["Increase specificity and connect the answer to real engineering decisions"]
