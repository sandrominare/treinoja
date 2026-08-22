"""
Copia todos os dados de um banco para outro (Railway Postgres / SQLite -> Neon).

Uso (PowerShell):
    $env:SOURCE_DATABASE_URL = "postgresql://...railway..."   # ou sqlite:///./treinoja.db
    $env:TARGET_DATABASE_URL = "postgresql://...neon.tech/neondb?sslmode=require"
    python scripts/migrate_db.py            # copia
    python scripts/migrate_db.py --verify   # só compara contagens

Nao precisa de pg_dump/psql — usa SQLAlchemy + psycopg2.
O destino deve estar vazio (tabelas sao criadas automaticamente).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, select, insert, func  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from database import normalize_url, Base  # noqa: E402
import models  # noqa: E402,F401  (registra as tabelas em Base.metadata)

TABLES_IN_ORDER = [
    "academias",
    "admins",
    "users",
    "workout_plans",
    "workout_history",
    "workout_progress",
]


def die(msg):
    print(f"ERRO: {msg}")
    sys.exit(1)


def main():
    verify_only = "--verify" in sys.argv
    src_url = os.getenv("SOURCE_DATABASE_URL")
    dst_url = os.getenv("TARGET_DATABASE_URL")
    if not src_url or not dst_url:
        die("defina SOURCE_DATABASE_URL e TARGET_DATABASE_URL")
    src_url, dst_url = normalize_url(src_url), normalize_url(dst_url)
    if src_url == dst_url:
        die("origem e destino sao iguais")

    src = create_engine(src_url, connect_args={"check_same_thread": False} if src_url.startswith("sqlite") else {})
    dst = create_engine(dst_url, pool_pre_ping=True)

    print(f"origem : {src.url.render_as_string(hide_password=True)}")
    print(f"destino: {dst.url.render_as_string(hide_password=True)}")

    Base.metadata.create_all(bind=dst)

    totals = {}
    with Session(src) as s_src, Session(dst) as s_dst:
        for name in TABLES_IN_ORDER:
            table = Base.metadata.tables[name]
            src_count = s_src.execute(select(func.count()).select_from(table)).scalar()
            dst_count = s_dst.execute(select(func.count()).select_from(table)).scalar()
            totals[name] = (src_count, dst_count)

            if verify_only:
                continue
            if dst_count:
                die(f"tabela '{name}' no destino ja tem {dst_count} linhas — destino deve estar vazio")

            rows = [dict(r._mapping) for r in s_src.execute(select(table)).all()]
            if rows:
                s_dst.execute(insert(table), rows)
                s_dst.commit()
            totals[name] = (src_count, len(rows))
            print(f"  {name:<18} {len(rows):>6} linhas")

        if not verify_only and dst.url.drivername.startswith("postgresql"):
            # IDs foram copiados explicitamente; realinha as sequences
            for name in TABLES_IN_ORDER:
                s_dst.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {name}), 0) + 1, false)"
                ))
            s_dst.commit()
            print("  sequences realinhadas")

    print("\nresumo (origem -> destino):")
    ok = True
    for name, (a, b) in totals.items():
        flag = "ok" if a == b else "DIFERENTE"
        ok &= a == b
        print(f"  {name:<18} {a:>6} -> {b:<6} {flag}")
    if not ok:
        sys.exit(2)
    print("\nconcluido.")


if __name__ == "__main__":
    main()
