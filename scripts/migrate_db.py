"""
Copia todos os dados de um banco para outro (Railway Postgres / SQLite -> Neon).

Uso (PowerShell):
    $env:SOURCE_DATABASE_URL = "postgresql://...railway..."   # ou sqlite:///./treinoja.db
    $env:TARGET_DATABASE_URL = "postgresql://...neon.tech/neondb?sslmode=require"
    python scripts/migrate_db.py            # copia
    python scripts/migrate_db.py --verify   # só compara contagens
    python scripts/migrate_db.py --http     # grava no Neon via HTTPS (porta 5432 bloqueada)

Nao precisa de pg_dump/psql — usa SQLAlchemy + psycopg2.
O destino deve estar vazio (tabelas sao criadas automaticamente).
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, select, insert, func  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable  # noqa: E402

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


class NeonHttp:
    """Destino via endpoint SQL-over-HTTPS do Neon (quando a porta 5432 esta bloqueada)."""

    def __init__(self, url: str):
        host = urlparse(url).hostname.replace("-pooler", "")
        self.endpoint = f"https://{host}/sql"
        self.conn_str = url.replace("&channel_binding=require", "")

    def run(self, sql, params=None):
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps({"query": sql, "params": params or []}).encode(),
            headers={"Neon-Connection-String": self.conn_str, "Content-Type": "application/json"},
        )
        try:
            return json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            die(f"Neon HTTP: {e.read().decode()}")

    def count(self, name):
        return int(self.run(f"SELECT count(*) AS n FROM {name}")["rows"][0]["n"])

    def create_schema(self):
        for t in Base.metadata.sorted_tables:
            self.run(str(CreateTable(t, if_not_exists=True).compile(dialect=postgresql.dialect())))
            for ix in t.indexes:
                self.run(str(CreateIndex(ix, if_not_exists=True).compile(dialect=postgresql.dialect())))

    def insert_rows(self, table, rows):
        cols = [c.name for c in table.columns]
        col_list = ", ".join(cols)
        for row in rows:
            vals = []
            for c in cols:
                v = row[c]
                if isinstance(v, datetime):
                    v = v.isoformat(sep=" ")
                elif isinstance(v, (dict, list)):
                    v = json.dumps(v)
                vals.append(v)
            ph = ", ".join(f"${i + 1}" for i in range(len(cols)))
            self.run(f"INSERT INTO {table.name} ({col_list}) VALUES ({ph})", vals)

    def reset_sequence(self, name):
        self.run(
            f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {name}), 0) + 1, false)"
        )


def main():
    verify_only = "--verify" in sys.argv
    use_http = "--http" in sys.argv
    src_url = os.getenv("SOURCE_DATABASE_URL")
    dst_url = os.getenv("TARGET_DATABASE_URL")
    if not src_url or not dst_url:
        die("defina SOURCE_DATABASE_URL e TARGET_DATABASE_URL")
    src_url, dst_url = normalize_url(src_url), normalize_url(dst_url)
    if src_url == dst_url:
        die("origem e destino sao iguais")

    src = create_engine(src_url, connect_args={"check_same_thread": False} if src_url.startswith("sqlite") else {})
    print(f"origem : {src.url.render_as_string(hide_password=True)}")

    if use_http:
        if "neon.tech" not in dst_url:
            die("--http so funciona com destino Neon")
        http = NeonHttp(dst_url)
        print(f"destino: {http.endpoint} (HTTPS)")
        http.create_schema()
    else:
        dst = create_engine(dst_url, pool_pre_ping=True)
        print(f"destino: {dst.url.render_as_string(hide_password=True)}")
        Base.metadata.create_all(bind=dst)

    totals = {}
    with Session(src) as s_src:
        s_dst = None if use_http else Session(dst)
        try:
            for name in TABLES_IN_ORDER:
                table = Base.metadata.tables[name]
                src_count = s_src.execute(select(func.count()).select_from(table)).scalar()
                dst_count = http.count(name) if use_http else s_dst.execute(
                    select(func.count()).select_from(table)).scalar()
                totals[name] = (src_count, dst_count)

                if verify_only:
                    continue
                if dst_count:
                    die(f"tabela '{name}' no destino ja tem {dst_count} linhas — destino deve estar vazio")

                rows = [dict(r._mapping) for r in s_src.execute(select(table)).all()]
                if rows:
                    if use_http:
                        http.insert_rows(table, rows)
                    else:
                        s_dst.execute(insert(table), rows)
                        s_dst.commit()
                totals[name] = (src_count, len(rows))
                print(f"  {name:<18} {len(rows):>6} linhas")

            if not verify_only:
                # IDs foram copiados explicitamente; realinha as sequences
                if use_http:
                    for name in TABLES_IN_ORDER:
                        http.reset_sequence(name)
                    print("  sequences realinhadas")
                elif dst.url.drivername.startswith("postgresql"):
                    for name in TABLES_IN_ORDER:
                        s_dst.execute(text(
                            f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                            f"COALESCE((SELECT MAX(id) FROM {name}), 0) + 1, false)"
                        ))
                    s_dst.commit()
                    print("  sequences realinhadas")
        finally:
            if s_dst is not None:
                s_dst.close()

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
