def generate_questions_from_scratch(job, parsed_resume: dict | None, count: int = 6):
    parsed_resume = parsed_resume or {}
    skills = parsed_resume.get("skills", [])
    projects = parsed_resume.get("projects", [])
    experience = parsed_resume.get("experience", [])
    requirements = [item.strip() for item in (job.requirements or "").split(",") if item.strip()]

    questions = []

    for req in requirements[:3]:
        questions.append(
            {
                "prompt": f"Your resume and this role both point to {req}. Walk me through a real example where you used it and what outcome you achieved.",
                "category": "technical",
            }
        )

    for skill in skills[:2]:
        questions.append(
            {
                "prompt": f"You list {skill} on your resume. Describe a project where it was important and explain one technical decision you made.",
                "category": "technical",
            }
        )

    if projects:
        questions.append(
            {
                "prompt": f"Tell me about this project from your resume: {projects[0]}. What problem were you solving and how did you structure the solution?",
                "category": "project",
            }
        )

    if experience:
        questions.append(
            {
                "prompt": f"In your experience section, you mention: {experience[0]}. What was the most challenging part and how did you handle it?",
                "category": "experience",
            }
        )

    questions.extend(
        [
            {
                "prompt": f"For the role of {job.title}, how would you break down a new feature from requirement to implementation and testing?",
                "category": "problem_solving",
            },
            {
                "prompt": "Describe a time you received technical feedback and how you improved your work afterward.",
                "category": "behavioral",
            },
        ]
    )

    seen = set()
    unique = []
    for item in questions:
        if item["prompt"] in seen:
            continue
        seen.add(item["prompt"])
        unique.append(item)
    return unique[:count]


def score_answer_from_scratch(question: str, answer: str, context_keywords: list[str]):
    text = (answer or "").strip()
    lower = text.lower()
    words = [token for token in lower.replace("\n", " ").split() if token]
    word_count = len(words)

    relevance_hits = sum(1 for keyword in context_keywords if keyword and keyword.lower() in lower)
    structure_hits = sum(1 for token in ["because", "so", "therefore", "result", "impact", "improved"] if token in lower)
    technical_hits = sum(
        1
        for token in ["api", "database", "frontend", "backend", "testing", "deployment", "performance", "bug", "design"]
        if token in lower
    )

    relevance_score = min(10, 3 + relevance_hits * 2)
    depth_score = min(10, 2 + technical_hits + (3 if word_count > 90 else 2 if word_count > 45 else 1 if word_count > 20 else 0))
    clarity_score = min(10, 3 + structure_hits + (2 if "." in text else 0))

    overall = round((relevance_score * 0.4 + depth_score * 0.35 + clarity_score * 0.25), 1)
    feedback = _feedback(overall, word_count, relevance_hits)

    return {
        "score": overall,
        "feedback": feedback,
        "wordCount": word_count,
        "relevanceScore": relevance_score,
        "depthScore": depth_score,
        "clarityScore": clarity_score,
    }


def build_score_report(attempt, answers):
    scored = []
    for answer in answers:
        scored.append(
            {
                "question": answer.question.prompt if answer.question else "",
                "score": answer.score or 0,
                "feedback": answer.feedback or "",
            }
        )

    if not scored:
        return {
            "overallScore": 0,
            "recommendation": "Incomplete",
            "strengths": ["Interview was not completed."],
            "growthAreas": ["Answer the interview questions to generate a report."],
            "overallSummary": "No completed responses were available for evaluation.",
            "technicalScore": 0,
            "communicationScore": 0,
            "problemSolvingScore": 0,
        }

    overall = round(sum(item["score"] for item in scored) / len(scored), 1)
    technical = round(min(10, overall + 0.4), 1)
    communication = round(min(10, overall + 0.1), 1)
    problem_solving = round(min(10, overall - 0.2 if overall > 0 else 0), 1)

    strengths = []
    growth = []
    if overall >= 8:
        recommendation = "Strong Hire"
        strengths = [
            "Explains technical work with clear structure",
            "Connects past experience to the target role well",
            "Shows solid implementation awareness",
        ]
        growth = ["Add even more discussion of tradeoffs and edge cases for senior-level interviews."]
    elif overall >= 6:
        recommendation = "Advance to Review"
        strengths = [
            "Demonstrates workable understanding of the main topics",
            "Provides generally relevant examples",
        ]
        growth = [
            "Use more specific project outcomes and metrics.",
            "Make design choices and technical tradeoffs clearer.",
        ]
    else:
        recommendation = "Needs Improvement"
        strengths = ["Shows baseline familiarity with the role topics."]
        growth = [
            "Increase answer depth with concrete examples.",
            "Tie responses more directly to the role and resume experience.",
        ]

    overall_summary = (
        f"Candidate completed {len(scored)} questions for the {attempt.job.title} interview and earned an overall score of {overall}/10. "
        f"The recommendation is {recommendation.lower()} based on relevance, clarity, and technical depth."
    )

    return {
        "overallScore": overall,
        "recommendation": recommendation,
        "strengths": strengths,
        "growthAreas": growth,
        "overallSummary": overall_summary,
        "technicalScore": technical,
        "communicationScore": communication,
        "problemSolvingScore": problem_solving,
    }


def _feedback(score, word_count, relevance_hits):
    if score >= 8:
        return "Strong answer with relevant detail, good structure, and convincing technical depth."
    if score >= 6:
        return (
            "Solid answer. Add sharper implementation detail, clearer outcomes, and stronger links to the role."
            if relevance_hits
            else "Reasonable foundation, but it needs more direct relevance to the question."
        )
    if word_count < 20:
        return "Answer is too brief. Expand with a real example, decisions made, and results."
    return "Answer needs more depth and specificity. Use concrete project details and explain your reasoning."
