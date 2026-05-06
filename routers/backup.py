import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from models import User, WorkoutHistory, WorkoutPlan
from routers.auth import get_current_user

router = APIRouter()


@router.get("/export")
def export_backup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user.id).first()
    entries = (
        db.query(WorkoutHistory)
        .filter(WorkoutHistory.user_id == user.id)
        .order_by(WorkoutHistory.completed_at.desc())
        .all()
    )

    backup = {
        "version": 2,
        "date": datetime.now(timezone.utc).isoformat(),
        "user": user.username,
        "data": plan.data if plan else {},
        "history": [
            {"treino": e.treino, "date": e.completed_at.isoformat(), "duration": e.duration}
            for e in entries
        ],
    }

    today = datetime.now().strftime("%Y-%m-%d")
    filename = f"treino_backup_{user.username}_{today}.json"
    return JSONResponse(
        content=backup,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        backup = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(400, "Arquivo inválido")

    if not backup.get("data"):
        raise HTTPException(400, "Arquivo de backup inválido")

    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user.id).first()
    if plan:
        plan.data = backup["data"]
        flag_modified(plan, "data")
    else:
        db.add(WorkoutPlan(user_id=user.id, data=backup["data"]))

    if backup.get("history"):
        db.query(WorkoutHistory).filter(WorkoutHistory.user_id == user.id).delete()
        for h in backup["history"]:
            date_str = h["date"].replace("Z", "+00:00")
            completed_at = datetime.fromisoformat(date_str).replace(tzinfo=None)
            db.add(
                WorkoutHistory(
                    user_id=user.id,
                    treino=h["treino"],
                    completed_at=completed_at,
                    duration=h.get("duration", 0),
                )
            )

    db.commit()
    return {"message": "Backup restaurado com sucesso!"}
