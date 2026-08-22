import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


def normalize_url(url: str) -> str:
    """Accept Railway/Heroku/Neon style URLs and make them SQLAlchemy-compatible."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Neon requires TLS; add sslmode if the URL doesn't already specify it
    if url.startswith("postgresql") and "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


DATABASE_URL = normalize_url(os.getenv("DATABASE_URL", "sqlite:///./treinoja.db"))

_sqlite = DATABASE_URL.startswith("sqlite")

if _sqlite:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Neon suspends idle compute, so connections in the pool can go stale;
    # pre_ping re-validates them and pool_recycle rotates them before Neon does.
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
