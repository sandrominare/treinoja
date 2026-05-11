import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models
from database import Base, SessionLocal, engine
from routers import auth, backup, history, progress, workouts
from routers import admin as admin_router
from routers.auth import hash_password

Base.metadata.create_all(bind=engine)

# Migrations: add columns introduced after initial deploy
with engine.connect() as _conn:
    from sqlalchemy import text as _text
    _pg = str(engine.url).startswith("postgresql")

    def _add_col(table: str, col: str, typedef: str):
        if _pg:
            stmt = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typedef}"
        else:
            stmt = f"ALTER TABLE {table} ADD COLUMN {col} {typedef}"
        try:
            _conn.execute(_text(stmt))
            _conn.commit()
        except Exception:
            _conn.rollback()

    _add_col("users",  "is_active",       "BOOLEAN NOT NULL DEFAULT TRUE")
    _add_col("users",  "plan_expires_at",  "TIMESTAMP")
    _add_col("users",  "academia_id",      "INTEGER")
    _add_col("admins", "academia_id",      "INTEGER")

app = FastAPI(title="TreinoJa", docs_url=None, redoc_url=None)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(workouts.router, prefix="/api/workouts", tags=["workouts"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(progress.router, prefix="/api/progress", tags=["progress"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])


@app.on_event("startup")
def create_initial_admin():
    db: Session = SessionLocal()
    try:
        # conta sandro legada (mantida para compatibilidade)
        if not db.query(models.Admin).filter(models.Admin.username == "sandro").first():
            db.add(models.Admin(username="sandro", password=hash_password("adm89"), is_active=True))

        # super-admin dedicado — nunca vinculado a academia
        sa_user = os.getenv("SUPERADMIN_USER", "superadmin")
        sa_pass = os.getenv("SUPERADMIN_PASS", "super@TreinoJa1")
        existing = db.query(models.Admin).filter(models.Admin.username == sa_user).first()
        if not existing:
            db.add(models.Admin(username=sa_user, password=hash_password(sa_pass), is_active=True, academia_id=None))
        else:
            existing.academia_id = None  # garante que nunca perde super-admin
        db.commit()
    finally:
        db.close()


@app.get("/")
async def index():
    return FileResponse("templates/index.html")


@app.get("/admin")
async def admin_page():
    return FileResponse("templates/admin.html")
