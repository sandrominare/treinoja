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
        if not db.query(models.Admin).filter(models.Admin.username == "sandro").first():
            db.add(models.Admin(username="sandro", password=hash_password("adm89"), is_active=True))
            db.commit()
    finally:
        db.close()


@app.get("/")
async def index():
    return FileResponse("templates/index.html")


@app.get("/admin")
async def admin_page():
    return FileResponse("templates/admin.html")
