from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String
from sqlalchemy.sql import func

from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    plan_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class WorkoutPlan(Base):
    __tablename__ = "workout_plans"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    data = Column(JSON, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class WorkoutHistory(Base):
    __tablename__ = "workout_history"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)
    treino = Column(String, nullable=False)
    completed_at = Column(DateTime, nullable=False)
    duration = Column(Integer, default=0)


class WorkoutProgress(Base):
    __tablename__ = "workout_progress"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, nullable=False)
    treino = Column(String, nullable=False)
