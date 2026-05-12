import json
import logging
from statistics import mean

from flask import current_app

from .interview_engine import build_question_set
from .interview_pipeline import build_score_report, score_answer_from_scratch

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
    fallback = score_answer_from_scratch(question, answer, requirements)
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
                    "content": (
                        "You are a fair but rigorous software interview evaluator. "
                        "Score on a 0 to 10 scale where 10 means excellent interview performance. "
                        "Reward concrete examples, technical correctness, tradeoff awareness, depth, and clarity. "
                        "Do not inflate scores for generic or shallow answers, but do give solid mid-range scores to partially strong answers."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Question: {question}\n"
                        f"Candidate answer: {answer}\n"
                        f"Target requirements: {', '.join(requirements) or 'General software engineering'}\n"
                        "Return score, concise feedback, strengths, and growth areas. "
                        "Assume this is a medium-to-hard interview and grade accordingly. "
                        "A decent relevant answer should usually land around 6 to 7.5 rather than being pushed too low."
                    ),
                },
            ],
            text={"format": {"type": "json_schema", **ANSWER_SCHEMA}},
        )
        parsed = json.loads(response.output_text)
        parsed["score"] = round(float(parsed.get("score", fallback["score"])), 1)
        parsed["score"] = max(0, min(10, parsed["score"]))
        parsed["wordCount"] = fallback["wordCount"]
        parsed["relevanceScore"] = fallback["relevanceScore"]
        parsed["depthScore"] = fallback["depthScore"]
        parsed["clarityScore"] = fallback["clarityScore"]
        return parsed
    except Exception as exc:  # pragma: no cover
        log.warning("Answer evaluation fell back to heuristic scoring: %s", exc)
        return fallback


def summarize_attempt_with_ai(attempt, answer_payloads: list[dict]):
    fallback = build_score_report(attempt, attempt.answers)
    client = _client()
    if not client or not answer_payloads:
        return fallback

    try:
        response = client.responses.create(
            model=current_app.config["OPENAI_MODEL"],
            input=[
                {
                    "role": "system",
                    "content": (
                        "You are writing a recruiter-ready interview assessment. "
                        "Use a 0 to 10 scale. Be specific, evidence-based, and balanced. "
                        "The final report must reflect answer quality across technical depth, communication, and problem solving."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Job title: {attempt.job.title}\n"
                        f"Job requirements: {attempt.job.requirements}\n"
                        f"Interview answers: {json.dumps(answer_payloads)}\n"
                        "Return an overall score, recommendation, strengths, and growth areas."
                    ),
                },
            ],
            text={"format": {"type": "json_schema", **SUMMARY_SCHEMA}},
        )
        parsed = json.loads(response.output_text)
        parsed["overallScore"] = round(float(parsed.get("overallScore", fallback["overallScore"])), 1)
        parsed["overallScore"] = max(0, min(10, parsed["overallScore"]))
        averages = _category_averages(answer_payloads)
        parsed["technicalScore"] = averages["technicalScore"]
        parsed["communicationScore"] = averages["communicationScore"]
        parsed["problemSolvingScore"] = averages["problemSolvingScore"]
        parsed["overallSummary"] = _overall_summary(attempt.job.title, parsed["overallScore"], parsed["recommendation"], parsed["strengths"], parsed["growthAreas"])
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
    if score >= 8:
        return [
            "Clear relevance to the target role",
            "Strong technical framing and communication",
        ]
    if score >= 6:
        return ["Reasonable command of the topic", "Shows practical implementation awareness"]
    return ["Demonstrates baseline familiarity with the topic"]


def _default_growth_areas(score: float):
    if score >= 8:
        return ["Go deeper on tradeoffs, failure modes, and operational constraints"]
    if score >= 6:
        return ["Use more concrete examples and measurable outcomes"]
    return ["Increase specificity and connect the answer to real engineering decisions"]


def _category_averages(answer_payloads: list[dict]):
    technical = []
    communication = []
    problem_solving = []

    for item in answer_payloads:
        score = float(item.get("score", 0) or 0)
        category = str(item.get("category", "") or "")
        feedback = str(item.get("feedback", "") or "").lower()
        question = str(item.get("question", "") or "").lower()

        communication_bonus = 0.4 if any(token in feedback for token in ["clear", "structured", "communicat"]) else 0
        problem_bonus = 0.4 if any(token in question for token in ["design", "debug", "problem", "tradeoff", "scale"]) else 0

        communication.append(min(10, score + communication_bonus))
        if "behavioral" not in category:
            technical.append(score)
        if any(token in category for token in ["system_design", "debugging", "problem_solving", "tradeoff", "hard"]):
            problem_solving.append(min(10, score + problem_bonus))
        else:
            problem_solving.append(max(0, score - 0.2))

    return {
        "technicalScore": round(mean(technical) if technical else 0, 1),
        "communicationScore": round(mean(communication) if communication else 0, 1),
        "problemSolvingScore": round(mean(problem_solving) if problem_solving else 0, 1),
    }


def _overall_summary(job_title: str, overall_score: float, recommendation: str, strengths: list[str], growth_areas: list[str]):
    top_strength = strengths[0] if strengths else "the candidate showed some relevant signals"
    top_growth = growth_areas[0] if growth_areas else "additional depth would improve confidence"
    return (
        f"For the {job_title} interview, the candidate earned {overall_score}/10 with a recommendation of {recommendation}. "
        f"The strongest signal was that {top_strength.lower()}. "
        f"The biggest next step is that {top_growth.lower()}."
    )
