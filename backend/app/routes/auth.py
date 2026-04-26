from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, jwt_required

from ..auth import current_user
from ..extensions import db, limiter
from ..models import RecruiterProfile, StudentProfile, User, UserRole

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
@limiter.limit("10 per minute")
def register():
    data = request.get_json() or {}
    required = ["name", "email", "password", "role"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({"message": f"Missing fields: {', '.join(missing)}"}), 400

    role = data["role"]
    if role not in {UserRole.STUDENT.value, UserRole.RECRUITER.value}:
        return jsonify({"message": "Invalid role"}), 400

    if User.query.filter_by(email=data["email"].lower().strip()).first():
        return jsonify({"message": "Email already registered"}), 409

    user = User(
        name=data["name"].strip(),
        email=data["email"].lower().strip(),
        role=role,
    )
    user.set_password(data["password"])
    db.session.add(user)
    db.session.flush()

    if role == UserRole.STUDENT.value:
        db.session.add(
            StudentProfile(
                user_id=user.id,
                headline=data.get("headline", ""),
                university=data.get("university", ""),
                skills=",".join(data.get("skills", []))
                if isinstance(data.get("skills"), list)
                else data.get("skills", ""),
                target_role=data.get("targetRole", ""),
            )
        )
    else:
        db.session.add(
            RecruiterProfile(
                user_id=user.id,
                company=data.get("company", ""),
                title=data.get("title", ""),
            )
        )

    db.session.commit()
    token = create_access_token(identity=str(user.id))
    return jsonify({"token": token, "user": _serialize_user(user)}), 201


@auth_bp.post("/login")
@limiter.limit("20 per minute")
def login():
    data = request.get_json() or {}
    email = (data.get("email") or "").lower().strip()
    password = data.get("password") or ""

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({"message": "Invalid credentials"}), 401

    token = create_access_token(identity=str(user.id))
    return jsonify({"token": token, "user": _serialize_user(user)})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = current_user()
    if not user:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"user": _serialize_user(user)})


def _serialize_user(user: User):
    payload = user.to_dict()
    if user.role == UserRole.STUDENT.value and user.student_profile:
        payload["profile"] = user.student_profile.to_dict()
    if user.role == UserRole.RECRUITER.value and user.recruiter_profile:
        payload["profile"] = user.recruiter_profile.to_dict()
    return payload
