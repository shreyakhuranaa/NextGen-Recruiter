def generate_questions_from_scratch(job, parsed_resume: dict | None, count: int = 10):
    parsed_resume = parsed_resume or {}
    skills = _normalize_items(parsed_resume.get("skills"))
    projects = _normalize_items(parsed_resume.get("projects"))
    experience = _normalize_items(parsed_resume.get("experience"))
    requirements = [item.strip() for item in (job.requirements or "").split(",") if item.strip()]
    focus_areas = [item.strip() for item in (job.interview_focus or "").split(",") if item.strip()]

    role_context = _role_context(job.title, job.description, requirements, focus_areas, skills)
    top_requirements = requirements[:5] or role_context["fallback_topics"]
    top_skills = skills[:4]
    top_projects = projects[:2]
    top_experience = experience[:2]

    questions = []

    for requirement in top_requirements[:2]:
        questions.append(
            {
                "prompt": (
                    f"Medium: This {job.title} role needs strong {requirement}. "
                    f"Describe a real implementation where you used it, the constraints you faced, "
                    "the architecture or approach you chose, and the measurable outcome."
                ),
                "category": "technical_medium",
            }
        )

    for requirement in top_requirements[2:4]:
        questions.append(
            {
                "prompt": (
                    f"Medium: {requirement} is listed as important for this {job.title} position. "
                    "Tell me about a time you had to make a concrete engineering decision in this area. "
                    "What options did you consider, why did you choose one path, and what result did it produce?"
                ),
                "category": "technical_medium",
            }
        )

    if top_skills:
        questions.append(
            {
                "prompt": (
                    f"Medium: You list {top_skills[0]} on your resume. "
                    "Walk me through a non-trivial problem you solved with it, including one tradeoff you had to make "
                    "and how you validated that your solution worked."
                ),
                "category": "technical_medium",
            }
        )

    if len(top_skills) > 1:
        questions.append(
            {
                "prompt": (
                    f"Medium: Compare how you have used {top_skills[0]} and {top_skills[1]} in different situations. "
                    "When was each the right choice, and what tradeoffs did you have to manage?"
                ),
                "category": "technical_medium",
            }
        )

    if top_projects:
        questions.append(
            {
                "prompt": (
                    f"Medium: In the project '{top_projects[0]}', what was the hardest engineering problem? "
                    "Explain your design, the alternatives you considered, and what you would improve in a second iteration."
                ),
                "category": "project_medium",
            }
        )
    if len(top_projects) > 1:
        questions.append(
            {
                "prompt": (
                    f"Hard: Looking at the project '{top_projects[1]}', imagine it suddenly needs to support much higher scale or complexity. "
                    "What would break first, how would you redesign it, and what engineering risks would you watch most closely?"
                ),
                "category": "project_hard",
            }
        )

    hard_topic = top_requirements[2] if len(top_requirements) > 2 else role_context["fallback_topics"][0]
    questions.append(
        {
            "prompt": (
                f"Hard: Design a production-ready solution for a {job.title} feature that depends on {hard_topic}. "
                "Explain the system design, data flow, failure cases, observability, testing strategy, and how you would scale it."
            ),
            "category": "system_design_hard",
        }
    )

    second_hard_topic = top_requirements[3] if len(top_requirements) > 3 else role_context["fallback_topics"][1]
    questions.append(
        {
            "prompt": (
                f"Hard: Imagine a critical issue appears in production around {second_hard_topic} and users are impacted. "
                "How would you investigate it end to end, isolate the root cause, communicate updates, and prevent the regression?"
            ),
            "category": "debugging_hard",
        }
    )

    if role_context["type"] == "frontend":
        questions.append(
            {
                "prompt": (
                    "Hard: A recruiter dashboard becomes slow after several new widgets are added. "
                    "How would you profile rendering, reduce unnecessary re-renders, manage network waterfalls, "
                    "and still keep the UI maintainable for future teams?"
                ),
                "category": "frontend_hard",
            }
        )
    elif role_context["type"] == "backend":
        questions.append(
            {
                "prompt": (
                    "Hard: A backend interview service must support spikes in concurrent candidates while keeping scoring consistent. "
                    "How would you design the API, persistence, async processing, and monitoring to handle scale and reliability?"
                ),
                "category": "backend_hard",
            }
        )
    elif role_context["type"] == "data":
        questions.append(
            {
                "prompt": (
                    "Hard: Design an analytics pipeline for interview outcomes that supports recruiter dashboards and historical analysis. "
                    "Explain the schema choices, data quality checks, refresh strategy, and how you would keep costs under control."
                ),
                "category": "data_hard",
            }
        )
    else:
        questions.append(
            {
                "prompt": (
                    f"Hard: For the {job.title} role, tell me about a difficult technical decision where speed, quality, and maintainability were in tension. "
                    "How would you decide, what tradeoffs would you document, and what signals would tell you later if the decision was wrong?"
                ),
                "category": "tradeoff_hard",
            }
        )

    if top_experience:
        questions.append(
            {
                "prompt": (
                    f"Medium: In your experience section you mention '{top_experience[0]}'. "
                    "What ownership did you personally take, what technical judgment did you apply, and what impact did your work have?"
                ),
                "category": "experience_medium",
            }
        )
    if len(top_experience) > 1:
        questions.append(
            {
                "prompt": (
                    f"Hard: In '{top_experience[1]}', what was a situation where the obvious solution would have been risky or weak? "
                    "Explain how you recognized that, what better path you chose, and how you judged success."
                ),
                "category": "experience_hard",
            }
        )

    questions.append(
        {
            "prompt": (
                f"Medium: For this {job.title} position, how would you take a feature from unclear requirements to release? "
                "Include stakeholder clarification, implementation planning, testing, rollout, and post-launch follow-up."
            ),
            "category": "problem_solving_medium",
        }
    )

    questions.append(
        {
            "prompt": (
                "Medium: Describe a time you received strong technical feedback or discovered your first solution was weak. "
                "How did you respond, what did you change, and what did you learn that improved your engineering judgment?"
            ),
            "category": "behavioral_medium",
        }
    )

    questions.append(
        {
            "prompt": (
                f"Hard: Suppose you join as a {job.title} and inherit a messy codebase that is slowing down delivery. "
                "How would you decide what to refactor first, what to leave alone, and how to improve speed without creating new reliability risks?"
            ),
            "category": "execution_hard",
        }
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
    structure_hits = sum(1 for token in ["because", "so", "therefore", "result", "impact", "improved", "tradeoff", "constraint"] if token in lower)
    technical_hits = sum(
        1
        for token in ["api", "database", "frontend", "backend", "testing", "deployment", "performance", "bug", "design", "scaling", "monitoring", "architecture"]
        if token in lower
    )
    evidence_hits = sum(1 for token in ["for example", "for instance", "measured", "metric", "latency", "users", "rollback"] if token in lower)
    penalty = 0
    if word_count < 12:
        penalty += 1.2
    if word_count < 6:
        penalty += 1.0
    if technical_hits == 0 and word_count < 25:
        penalty += 0.4

    relevance_score = min(10, 4 + relevance_hits * 1.8)
    depth_score = min(10, 3 + technical_hits + evidence_hits + (3 if word_count > 80 else 2 if word_count > 35 else 1 if word_count > 15 else 0))
    clarity_score = min(10, 4 + structure_hits + (1.5 if "." in text else 0))

    overall = round(max(0, min(10, (relevance_score * 0.4 + depth_score * 0.35 + clarity_score * 0.25) - penalty)), 1)
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
    technical = round(min(10, overall + 0.2), 1)
    communication = round(min(10, overall + 0.1), 1)
    problem_solving = round(min(10, overall + 0.3), 1)

    strengths = []
    growth = []
    if overall >= 8.2:
        recommendation = "Strong Hire"
        strengths = [
            "Explains technical work with clear structure",
            "Connects past experience to the target role well",
            "Shows solid implementation awareness",
        ]
        growth = ["Add even more discussion of tradeoffs and edge cases for senior-level interviews."]
    elif overall >= 6.5:
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
    if score >= 8.2:
        return "Strong answer with relevant detail, good structure, and convincing technical depth."
    if score >= 6.5:
        return (
            "Solid answer. Add sharper implementation detail, clearer outcomes, and stronger links to the role."
            if relevance_hits
            else "Reasonable foundation, but it needs more direct relevance to the question."
        )
    if word_count < 20:
        return "Answer is too brief. Expand with a real example, decisions made, and results."
    return "Answer needs more depth and specificity. Use concrete project details and explain your reasoning."


def _normalize_items(value):
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def _role_context(title: str, description: str, requirements: list[str], focus_areas: list[str], skills: list[str]):
    lowered = " ".join([title or "", description or "", *requirements, *focus_areas, *skills]).lower()

    if any(token in lowered for token in ["react", "frontend", "javascript", "ui", "css", "web"]):
        return {
            "type": "frontend",
            "fallback_topics": ["state management", "performance", "component architecture"],
        }
    if any(token in lowered for token in ["backend", "flask", "django", "api", "microservice", "python", "node"]):
        return {
            "type": "backend",
            "fallback_topics": ["api design", "reliability", "database performance"],
        }
    if any(token in lowered for token in ["sql", "analytics", "data", "etl", "warehouse", "postgresql"]):
        return {
            "type": "data",
            "fallback_topics": ["data modeling", "query optimization", "data quality"],
        }
    return {
        "type": "general",
        "fallback_topics": ["system design", "debugging", "technical tradeoffs"],
    }
