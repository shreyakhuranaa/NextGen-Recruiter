from app import create_app
from app.extensions import db
from app.models import Job, RecruiterProfile, StudentProfile, User

app = create_app()


with app.app_context():
    if not User.query.filter_by(email="recruiter@nextgen.ai").first():
        recruiter = User(name="Ava Recruiter", email="recruiter@nextgen.ai", role="recruiter")
        recruiter.set_password("password123")
        db.session.add(recruiter)
        db.session.flush()
        db.session.add(
            RecruiterProfile(user_id=recruiter.id, company="NextGen AI", title="Lead Recruiter")
        )

    if not User.query.filter_by(email="student@nextgen.ai").first():
        student = User(name="Sam Student", email="student@nextgen.ai", role="student")
        student.set_password("password123")
        db.session.add(student)
        db.session.flush()
        db.session.add(
            StudentProfile(
                user_id=student.id,
                headline="Full-stack student engineer",
                university="Global Tech University",
                skills="React,Flask,PostgreSQL,APIs",
                target_role="Software Engineer Intern",
            )
        )

    recruiter = User.query.filter_by(email="recruiter@nextgen.ai").first()
    if recruiter and not Job.query.filter_by(title="Frontend Engineer Intern").first():
        db.session.add(
            Job(
                recruiter_id=recruiter.id,
                title="Frontend Engineer Intern",
                department="Engineering",
                location="Remote",
                description="Build polished recruiter and student experiences for the interview platform.",
                requirements="React,Tailwind CSS,APIs,JavaScript,Product thinking",
                interview_focus="Frontend architecture, state management, API integration, and communication.",
                status="active",
            )
        )

    db.session.commit()
    print("Seed data ready.")
