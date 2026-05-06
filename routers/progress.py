from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, WorkoutProgress
from routers.auth import get_current_user

router = APIRouter()


class ProgressData(BaseModel):
    treino: str


@router.get("")
def get_progress(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.query(WorkoutProgress).filter(WorkoutProgress.user_id == user.id).first()
    if not p:
        return None
    return {"treino": p.treino}


@router.put("")
def set_progress(
    data: ProgressData,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = db.query(WorkoutProgress).filter(WorkoutProgress.user_id == user.id).first()
    if p:
        p.treino = data.treino
    else:
        db.add(WorkoutProgress(user_id=user.id, treino=data.treino))
    db.commit()
    return {"ok": True}


@router.delete("")
def clear_progress(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(WorkoutProgress).filter(WorkoutProgress.user_id == user.id).delete()
    db.commit()
    return {"ok": True}
