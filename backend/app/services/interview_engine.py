from statistics import mean


QUESTION_BANK = {
    "react": [
        "Explain how you manage shared state across a multi-step React workflow without creating brittle prop chains.",
        "Describe a performance issue you might encounter in a React dashboard and how you would diagnose it.",
    ],
    "python": [
        "How would you structure a backend service so interview scoring logic stays maintainable as requirements expand?",
        "Explain a time when choosing the right Python abstraction improved product reliability or developer speed.",
    ],
    "sql": [
        "What tradeoffs do you consider when modeling candidate analytics in PostgreSQL for both reporting and transactional workloads?",
        "How would you optimize a recruiter dashboard query that joins jobs, applications, and interview results?",
    ],
}

GENERIC_QUESTIONS = [
    "Walk me through a project where you improved a product outcome, not just the code.",
    "How do you balance shipping speed with long-term maintainability in a production system?",
    "Describe how you would debug a customer-facing bug that only appears intermittently.",
    "Tell me about a time you used data to influence a product or hiring decision.",
]

POSITIVE_SIGNALS = {
    "scalable",
    "testing",
    "metrics",
    "performance",
    "security",
    "latency",
    "database",
    "api",
    "users",
    "architecture",
    "tradeoff",
    "monitoring",
    "deployment",
    "postgresql",
    "react",
    "flask",
}


def build_question_set(job_title: str, requirements: list[str], count: int = 5):
    questions = []
    lowered = " ".join([job_title, *requirements]).lower()
    used = set()
    for keyword, prompts in QUESTION_BANK.items():
        if keyword in lowered:
            for prompt in prompts:
                if prompt not in used:
                    questions.append(prompt)
                    used.add(prompt)
    for prompt in GENERIC_QUESTIONS:
        if prompt not in used:
            questions.append(prompt)
    return questions[:count]


def score_answer(question: str, answer: str, requirements: list[str]):
    text = (answer or "").strip()
    words = [token.strip(".,!?():;").lower() for token in text.split()]
    word_count = len([token for token in words if token])

    requirement_hits = 0
    lowered_answer = text.lower()
    for item in requirements:
        fragments = [part.strip().lower() for part in item.split() if len(part.strip()) > 3]
        if any(fragment in lowered_answer for fragment in fragments):
            requirement_hits += 1

    signal_hits = sum(1 for token in set(words) if token in POSITIVE_SIGNALS)
    structure_bonus = 8 if "." in text or "," in text else 0
    depth_score = min(40, word_count * 0.45)
    relevance_score = min(35, requirement_hits * 8 + signal_hits * 3)
    clarity_score = min(25, structure_bonus + (12 if word_count > 45 else 6 if word_count > 20 else 0))

    total = round(min(100, depth_score + relevance_score + clarity_score), 1)

    if total >= 80:
        feedback = "Strong answer with clear technical depth, relevant examples, and thoughtful tradeoff awareness."
    elif total >= 60:
        feedback = "Solid answer. Add sharper examples, measurable outcomes, or more explicit tradeoffs to stand out."
    else:
        feedback = "Answer needs more detail and relevance. Tie your response to real systems, decisions, and concrete outcomes."

    return {
        "score": total,
        "feedback": feedback,
        "wordCount": word_count,
        "matchedRequirements": requirement_hits,
    }


def summarize_attempt(answer_scores: list[float]):
    if not answer_scores:
        return {
            "overallScore": 0,
            "recommendation": "Pending",
            "strengths": [],
            "growthAreas": ["Complete the interview to unlock insights."],
        }

    overall = round(mean(answer_scores), 1)
    if overall >= 80:
        recommendation = "Strong Hire"
        strengths = [
            "Communicates structured solutions clearly",
            "Shows strong alignment with role requirements",
            "Demonstrates product-aware technical thinking",
        ]
        growth = ["Push deeper into edge cases and system constraints for senior-level roles."]
    elif overall >= 65:
        recommendation = "Advance to Review"
        strengths = [
            "Covers core concepts with reasonable confidence",
            "Demonstrates workable implementation thinking",
        ]
        growth = [
            "Use more concrete examples from past work.",
            "Make tradeoffs and impact more explicit.",
        ]
    else:
        recommendation = "Needs Review"
        strengths = ["Shows baseline familiarity with the interview topics."]
        growth = [
            "Improve answer depth and specificity.",
            "Tie responses more directly to the target job requirements.",
        ]

    return {
        "overallScore": overall,
        "recommendation": recommendation,
        "strengths": strengths,
        "growthAreas": growth,
    }
