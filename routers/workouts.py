import json
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from models import User, WorkoutPlan
from routers.auth import get_current_user

router = APIRouter()


def get_default_data() -> dict:
    path = os.path.join(os.path.dirname(__file__), "..", "data", "default_training.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_or_create_plan(user: User, db: Session) -> WorkoutPlan:
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user.id).first()
    if not plan:
        plan = WorkoutPlan(user_id=user.id, data=get_default_data())
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


@router.get("")
def get_workouts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_or_create_plan(user, db)
    return plan.data


@router.put("")
def save_workouts(
    data: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user.id).first()
    if plan:
        plan.data = data
        flag_modified(plan, "data")
    else:
        plan = WorkoutPlan(user_id=user.id, data=data)
        db.add(plan)
    db.commit()
    return {"ok": True}
