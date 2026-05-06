from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, WorkoutHistory
from routers.auth import get_current_user

router = APIRouter()


class HistoryEntry(BaseModel):
    treino: str
    date: str
    duration: int = 0


@router.get("")
def get_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entries = (
        db.query(WorkoutHistory)
        .filter(WorkoutHistory.user_id == user.id)
        .order_by(WorkoutHistory.completed_at.desc())
        .all()
    )
    return [
        {"treino": e.treino, "date": e.completed_at.isoformat(), "duration": e.duration}
        for e in entries
    ]


@router.post("")
def add_history(
    entry: HistoryEntry,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    date_str = entry.date.replace("Z", "+00:00")
    completed_at = datetime.fromisoformat(date_str).replace(tzinfo=None)
    h = WorkoutHistory(
        user_id=user.id,
        treino=entry.treino,
        completed_at=completed_at,
        duration=entry.duration,
    )
    db.add(h)
    db.commit()
    return {"ok": True}
