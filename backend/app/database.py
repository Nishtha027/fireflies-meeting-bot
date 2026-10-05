import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


def _database_url() -> str:
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    db = os.environ["POSTGRES_DB"]
    port = os.environ.get("POSTGRES_HOST_PORT", "5433")
    # 127.0.0.1, not "localhost": docker-compose publishes this port on IPv4
    # loopback only, but on Windows/WSL2 "localhost" resolves to ::1 first
    # and that attempt can hang for ~21 s (Windows' TCP connect timeout)
    # before falling back to IPv4 - measured: 21 s per NEW connection vs
    # 0.04 s. Pooling hides it until a connection has to be re-opened.
    return f"postgresql+psycopg2://{user}:{password}@127.0.0.1:{port}/{db}"


# Postgres runs in a Docker container on a Windows/WSL2 host that can
# restart under us (Docker Desktop restarts, sleep/resume). Without these, a
# pooled connection that died with the old container is handed to the next
# request and can hang for minutes on a black-holed socket, starving the
# thread pool until the whole API looks down:
# - pool_pre_ping: test a connection on checkout, transparently replacing dead ones
# - pool_recycle: don't keep any connection older than 30 min
# - TCP keepalives + connect_timeout: a silently dropped socket is detected in
#   ~60s and a missing server fails fast instead of waiting on the OS default
engine = create_engine(
    _database_url(),
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    },
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: yields a session, always closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
