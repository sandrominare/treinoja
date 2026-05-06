import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import models
from database import Base, engine
from routers import auth, backup, history, progress, workouts

Base.metadata.create_all(bind=engine)

app = FastAPI(title="TreinoJa", docs_url=None, redoc_url=None)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(workouts.router, prefix="/api/workouts", tags=["workouts"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(progress.router, prefix="/api/progress", tags=["progress"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])


@app.get("/")
async def index():
    return FileResponse("templates/index.html")
