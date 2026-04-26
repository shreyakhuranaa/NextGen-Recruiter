import logging

from flask import Flask, jsonify

from config import Config

from .extensions import cors, db, jwt, limiter, migrate
from .routes.auth import auth_bp
from .routes.jobs import jobs_bp
from .routes.recruiter import recruiter_bp
from .routes.student import student_bp


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    logging.basicConfig(level=logging.INFO)

    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db)
    limiter.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", "*")}},
        supports_credentials=True,
    )

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(jobs_bp, url_prefix="/api/jobs")
    app.register_blueprint(student_bp, url_prefix="/api/student")
    app.register_blueprint(recruiter_bp, url_prefix="/api/recruiter")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"message": "Resource not found"}), 404

    @app.errorhandler(429)
    def too_many_requests(_error):
        return jsonify({"message": "Too many requests"}), 429

    @app.errorhandler(500)
    def server_error(_error):
        return jsonify({"message": "Internal server error"}), 500

    with app.app_context():
        if app.config.get("AUTO_CREATE_TABLES", False):
            db.create_all()

    return app
