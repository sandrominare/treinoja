import json
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from models import Academia, Admin, User, WorkoutHistory, WorkoutPlan, WorkoutProgress
from routers.auth import hash_password, validate_password, verify_password

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY", "treinoja-secret-mude-em-producao")
ALGORITHM = "HS256"
ADMIN_COOKIE = "admin_session"


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _create_token(admin_id: int) -> str:
    payload = {
        "sub": str(admin_id),
        "type": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_admin(
    admin_session: str = Cookie(default=None), db: Session = Depends(get_db)
) -> Admin:
    if not admin_session:
        raise HTTPException(401, "Não autenticado")
    try:
        payload = jwt.decode(admin_session, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "admin":
            raise HTTPException(401, "Token inválido")
        admin_id = int(payload["sub"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessão inválida")
    admin = db.query(Admin).filter(Admin.id == admin_id, Admin.is_active == True).first()
    if not admin:
        raise HTTPException(401, "Acesso negado")
    return admin


def _is_super(admin: Admin) -> bool:
    return admin.academia_id is None


def _assert_user_access(user: User, admin: Admin):
    if not _is_super(admin) and user.academia_id != admin.academia_id:
        raise HTTPException(403, "Acesso negado")


def _assert_trainer_access(trainer: Admin, admin: Admin):
    if not _is_super(admin) and trainer.academia_id != admin.academia_id:
        raise HTTPException(403, "Acesso negado")


def _load_default_data() -> dict:
    path = os.path.join(os.path.dirname(__file__), "..", "data", "default_training.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _academia_nome(academia_id, db: Session) -> str:
    if academia_id is None:
        return "—"
    a = db.query(Academia).filter(Academia.id == academia_id).first()
    return a.nome if a else "?"


# ── Auth endpoints ────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    username = data.username.strip().lower()
    admin = db.query(Admin).filter(Admin.username == username).first()
    if not admin or not verify_password(data.password, admin.password):
        raise HTTPException(401, "Usuário ou senha incorretos")
    if not admin.is_active:
        raise HTTPException(403, "Conta desativada")
    token = _create_token(admin.id)
    response.set_cookie(ADMIN_COOKIE, token, httponly=True, max_age=60 * 60 * 24 * 7, samesite="lax")
    academia = _academia_nome(admin.academia_id, db)
    return {
        "id": admin.id,
        "username": admin.username,
        "academia_id": admin.academia_id,
        "academia_nome": academia,
        "is_superadmin": _is_super(admin),
    }


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


@router.get("/auth/me")
def me(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    academia = _academia_nome(admin.academia_id, db)
    return {
        "id": admin.id,
        "username": admin.username,
        "academia_id": admin.academia_id,
        "academia_nome": academia,
        "is_superadmin": _is_super(admin),
    }


# ── Academias (super-admin only) ──────────────────────────────────────────────

class AcademiaCreate(BaseModel):
    nome: str
    codigo: str
    is_active: bool = True


class AcademiaUpdate(BaseModel):
    nome: str | None = None
    codigo: str | None = None
    is_active: bool | None = None


@router.get("/academias")
def list_academias(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not _is_super(admin):
        raise HTTPException(403, "Acesso negado")
    academias = db.query(Academia).order_by(Academia.nome).all()
    result = []
    for a in academias:
        users_count = db.query(User).filter(User.academia_id == a.id).count()
        trainers_count = db.query(Admin).filter(Admin.academia_id == a.id).count()
        result.append({
            "id": a.id,
            "nome": a.nome,
            "codigo": a.codigo,
            "is_active": a.is_active,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "users_count": users_count,
            "trainers_count": trainers_count,
        })
    return result


@router.post("/academias")
def create_academia(
    data: AcademiaCreate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not _is_super(admin):
        raise HTTPException(403, "Acesso negado")
    nome = data.nome.strip()
    codigo = data.codigo.strip().upper()
    if not nome or not codigo:
        raise HTTPException(400, "Nome e código são obrigatórios")
    if db.query(Academia).filter(Academia.codigo == codigo).first():
        raise HTTPException(400, "Código já existe")
    a = Academia(nome=nome, codigo=codigo, is_active=data.is_active)
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"id": a.id, "nome": a.nome, "codigo": a.codigo, "is_active": a.is_active}


@router.put("/academias/{academia_id}")
def update_academia(
    academia_id: int,
    data: AcademiaUpdate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not _is_super(admin):
        raise HTTPException(403, "Acesso negado")
    a = db.query(Academia).filter(Academia.id == academia_id).first()
    if not a:
        raise HTTPException(404, "Academia não encontrada")
    if data.nome is not None:
        a.nome = data.nome.strip()
    if data.codigo is not None:
        new_cod = data.codigo.strip().upper()
        if new_cod != a.codigo and db.query(Academia).filter(Academia.codigo == new_cod).first():
            raise HTTPException(400, "Código já existe")
        a.codigo = new_cod
    if data.is_active is not None:
        a.is_active = data.is_active
    db.commit()
    return {"ok": True}


@router.delete("/academias/{academia_id}")
def delete_academia(
    academia_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not _is_super(admin):
        raise HTTPException(403, "Acesso negado")
    a = db.query(Academia).filter(Academia.id == academia_id).first()
    if not a:
        raise HTTPException(404, "Academia não encontrada")
    # Unlink users and trainers instead of deleting
    db.query(User).filter(User.academia_id == academia_id).update({"academia_id": None})
    db.query(Admin).filter(Admin.academia_id == academia_id).update({"academia_id": None})
    db.delete(a)
    db.commit()
    return {"ok": True}


# ── Users ─────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    plan_expires_at: str | None = None
    academia_id: int | None = None


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    is_active: bool | None = None
    plan_expires_at: str | None = None
    academia_id: int | None = None


def _user_row(u: User, db: Session) -> dict:
    count = db.query(WorkoutHistory).filter(WorkoutHistory.user_id == u.id).count()
    last = (
        db.query(WorkoutHistory)
        .filter(WorkoutHistory.user_id == u.id)
        .order_by(WorkoutHistory.completed_at.desc())
        .first()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    plan_expired = u.plan_expires_at is not None and u.plan_expires_at < now
    return {
        "id": u.id,
        "username": u.username,
        "is_active": u.is_active,
        "plan_expires_at": u.plan_expires_at.isoformat() if u.plan_expires_at else None,
        "plan_expired": plan_expired,
        "academia_id": u.academia_id,
        "academia_nome": _academia_nome(u.academia_id, db),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "workouts_done": count,
        "last_workout": last.completed_at.isoformat() if last else None,
    }


@router.get("/users")
def list_users(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    q = db.query(User)
    if not _is_super(admin):
        q = q.filter(User.academia_id == admin.academia_id)
    return [_user_row(u, db) for u in q.order_by(User.username).all()]


@router.post("/users")
def create_user(
    data: UserCreate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    username = data.username.strip().lower()
    if not username:
        raise HTTPException(400, "Usuário é obrigatório")
    validate_password(data.password)
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "Usuário já existe")
    # academia: use admin's gym unless super-admin specifies one
    academia_id = admin.academia_id if not _is_super(admin) else data.academia_id
    expires_at = datetime.fromisoformat(data.plan_expires_at) if data.plan_expires_at else None
    user = User(
        username=username,
        password=hash_password(data.password),
        is_active=True,
        plan_expires_at=expires_at,
        academia_id=academia_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_row(user, db)


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    data: UserUpdate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    _assert_user_access(user, admin)
    if data.username is not None:
        new_u = data.username.strip().lower()
        if new_u != user.username and db.query(User).filter(User.username == new_u).first():
            raise HTTPException(400, "Nome de usuário já existe")
        user.username = new_u
    if data.password:
        validate_password(data.password)
        user.password = hash_password(data.password)
    if data.is_active is not None:
        user.is_active = data.is_active
    if "plan_expires_at" in data.model_fields_set:
        user.plan_expires_at = datetime.fromisoformat(data.plan_expires_at) if data.plan_expires_at else None
    if _is_super(admin) and "academia_id" in data.model_fields_set:
        user.academia_id = data.academia_id
    db.commit()
    return _user_row(user, db)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    _assert_user_access(user, admin)
    db.query(WorkoutHistory).filter(WorkoutHistory.user_id == user_id).delete()
    db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user_id).delete()
    db.query(WorkoutProgress).filter(WorkoutProgress.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"ok": True}


# ── Trainers ──────────────────────────────────────────────────────────────────

class TrainerCreate(BaseModel):
    username: str
    password: str
    academia_id: int | None = None


class TrainerUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    is_active: bool | None = None
    academia_id: int | None = None


@router.get("/trainers")
def list_trainers(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    q = db.query(Admin)
    if not _is_super(admin):
        q = q.filter(Admin.academia_id == admin.academia_id)
    trainers = q.order_by(Admin.username).all()
    return [
        {
            "id": t.id,
            "username": t.username,
            "is_active": t.is_active,
            "academia_id": t.academia_id,
            "academia_nome": _academia_nome(t.academia_id, db),
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in trainers
    ]


@router.post("/trainers")
def create_trainer(
    data: TrainerCreate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    username = data.username.strip().lower()
    if not username:
        raise HTTPException(400, "Usuário é obrigatório")
    if len(data.password) < 4:
        raise HTTPException(400, "Senha deve ter pelo menos 4 caracteres")
    if db.query(Admin).filter(Admin.username == username).first():
        raise HTTPException(400, "Usuário já existe")
    academia_id = admin.academia_id if not _is_super(admin) else data.academia_id
    trainer = Admin(username=username, password=hash_password(data.password), is_active=True, academia_id=academia_id)
    db.add(trainer)
    db.commit()
    db.refresh(trainer)
    return {
        "id": trainer.id,
        "username": trainer.username,
        "is_active": trainer.is_active,
        "academia_id": trainer.academia_id,
        "academia_nome": _academia_nome(trainer.academia_id, db),
    }


@router.put("/trainers/{trainer_id}")
def update_trainer(
    trainer_id: int,
    data: TrainerUpdate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    trainer = db.query(Admin).filter(Admin.id == trainer_id).first()
    if not trainer:
        raise HTTPException(404, "Professor não encontrado")
    _assert_trainer_access(trainer, admin)
    if data.username is not None:
        new_u = data.username.strip().lower()
        if new_u != trainer.username and db.query(Admin).filter(Admin.username == new_u).first():
            raise HTTPException(400, "Nome já existe")
        trainer.username = new_u
    if data.password:
        if len(data.password) < 4:
            raise HTTPException(400, "Senha deve ter pelo menos 4 caracteres")
        trainer.password = hash_password(data.password)
    if data.is_active is not None:
        if not data.is_active and trainer_id == admin.id:
            raise HTTPException(400, "Não é possível desativar a própria conta")
        trainer.is_active = data.is_active
    if _is_super(admin) and "academia_id" in data.model_fields_set:
        trainer.academia_id = data.academia_id
    db.commit()
    return {"ok": True}


@router.delete("/trainers/{trainer_id}")
def delete_trainer(
    trainer_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if trainer_id == admin.id:
        raise HTTPException(400, "Não é possível excluir a própria conta")
    trainer = db.query(Admin).filter(Admin.id == trainer_id).first()
    if not trainer:
        raise HTTPException(404, "Professor não encontrado")
    _assert_trainer_access(trainer, admin)
    db.delete(trainer)
    db.commit()
    return {"ok": True}


# ── Workouts per user ─────────────────────────────────────────────────────────

@router.get("/users/{user_id}/workouts")
def get_user_workouts(
    user_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    _assert_user_access(user, admin)
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user_id).first()
    return plan.data if plan else _load_default_data()


@router.put("/users/{user_id}/workouts")
def update_user_workouts(
    user_id: int,
    data: dict,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    _assert_user_access(user, admin)
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user_id).first()
    if plan:
        plan.data = data
        flag_modified(plan, "data")
    else:
        db.add(WorkoutPlan(user_id=user_id, data=data))
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/workouts")
def reset_user_workouts(
    user_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    _assert_user_access(user, admin)
    plan = db.query(WorkoutPlan).filter(WorkoutPlan.user_id == user_id).first()
    if plan:
        plan.data = _load_default_data()
        flag_modified(plan, "data")
        db.commit()
    return {"ok": True}
