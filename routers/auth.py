import hashlib
import os
import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY", "treinoja-secret-mude-em-producao")
ALGORITHM = "HS256"
TOKEN_DAYS = 30


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return salt.hex() + ":" + key.hex()


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, key_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
        return key.hex() == key_hex
    except Exception:
        return False


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> int:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return int(payload["sub"])


def validate_password(pwd: str):
    if not re.match(r"^\d+$", pwd):
        raise HTTPException(400, "A senha deve ser numérica.")
    if len(pwd) < 4:
        raise HTTPException(400, "A senha deve ter pelo menos 4 dígitos.")
    if len(set(pwd)) != len(pwd):
        raise HTTPException(400, "A senha não pode ter dígitos repetidos.")


def get_current_user(
    session: str = Cookie(default=None), db: Session = Depends(get_db)
) -> User:
    if not session:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        user_id = verify_token(session)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão inválida")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return user


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    username = data.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(data.password, user.password):
        raise HTTPException(401, "Usuário ou senha incorretos")
    if not user.is_active:
        raise HTTPException(403, "Conta suspensa. Contate seu professor.")

    token = create_token(user.id)
    response.set_cookie(
        "session", token, httponly=True, max_age=60 * 60 * 24 * TOKEN_DAYS, samesite="lax"
    )
    return {"username": user.username}


@router.post("/register")
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    username = data.username.strip().lower()
    if not username:
        raise HTTPException(400, "Usuário é obrigatório")
    validate_password(data.password)
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "Usuário já existe")

    user = User(username=username, password=hash_password(data.password))
    db.add(user)
    db.commit()
    return {"message": "Usuário criado com sucesso!"}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("session")
    return {"message": "ok"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    plan_expired = user.plan_expires_at is not None and user.plan_expires_at < now
    return {
        "username": user.username,
        "is_active": user.is_active,
        "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
        "plan_expired": plan_expired,
    }
