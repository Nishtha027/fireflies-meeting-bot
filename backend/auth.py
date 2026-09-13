"""
Single-admin login for Meetscribe: exactly one account, ever, stored in the
admin_account table (see app/models.py - the table's primary key is
hardcoded to id=1 and CHECK(id = 1)'d, so a second row can never physically
exist in Postgres, independent of the existence-check in create_account
below).

First run: no row exists yet - POST /auth/setup (main.py) creates it (name,
email, password) and logs the caller in immediately. Every run after that,
POST /auth/setup is rejected with 409 (AccountExistsError), and POST
/auth/login is how the one account signs in. Session state is a JWT in an
httpOnly cookie, same as before this feature - the database is now the
source of truth for the account instead of backend/.env.

require_auth() is the FastAPI dependency every protected endpoint in
main.py depends on (via the `protected` router) - it raises 401 if the
session cookie is missing, malformed, or expired. It never touches the
database: the JWT signature + expiry alone prove the session, so protected
requests don't pay for a DB round trip just to check auth (there's no
account-deletion endpoint that could make a still-valid JWT stale).
get_current_account() is the soft variant GET /auth/me uses: it never
raises, and does look the account up (to return name/email for display).
"""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from dotenv import load_dotenv
from fastapi import Cookie, Depends, HTTPException
from jose import JWTError, jwt
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AdminAccount

load_dotenv()

COOKIE_NAME = "access_token"
ALGORITHM = "HS256"
# A single self-hosted operator logging into their own tool: 7 days trades
# off convenience (no re-login every day for a personal/manager dashboard)
# against exposure window (a leaked cookie is only useful for a week, and
# there's no refresh-token rotation in scope to justify going longer).
TOKEN_EXPIRE_DAYS = 7

# The one account's row always lives at this id - see AdminAccount's
# CHECK(id = 1) constraint in app/models.py.
SINGLETON_ID = 1

# A password hash to check against when no account exists yet, so
# verify_credentials() always does the same bcrypt work whether or not an
# account exists - timing doesn't leak whether setup has run.
_DUMMY_HASH = bcrypt.hashpw(b"no-account-yet", bcrypt.gensalt()).decode("utf-8")


class AuthError(Exception):
    """Base class for auth failures - callers decide how to present them."""


class InvalidCredentialsError(AuthError):
    """Email/password didn't match the stored account, or the session
    cookie was missing/malformed/expired."""


class AccountExistsError(AuthError):
    """POST /auth/setup was called after the one account already exists."""


class AuthConfigError(AuthError):
    """JWT_SECRET_KEY is not set."""


def _get_secret_key() -> str:
    try:
        return os.environ["JWT_SECRET_KEY"]
    except KeyError as exc:
        raise AuthConfigError(
            "JWT_SECRET_KEY is not set - check backend/.env."
        ) from exc


def account_exists(db: Session) -> bool:
    return db.get(AdminAccount, SINGLETON_ID) is not None


def create_account(db: Session, name: str, email: str, password: str) -> AdminAccount:
    """Raises AccountExistsError if the one account already exists.

    The up-front account_exists() check gives a clean, fast 409 in the
    common case. The try/except around commit() is the real guarantee: even
    if two setup requests race past that check, only one INSERT can win -
    the other hits the id=1 primary key (and CHECK(id = 1)) and raises
    IntegrityError, which we turn into the same AccountExistsError.
    """
    if account_exists(db):
        raise AccountExistsError("An account already exists.")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    account = AdminAccount(id=SINGLETON_ID, name=name, email=email, password_hash=password_hash)
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AccountExistsError("An account already exists.")
    db.refresh(account)
    return account


def verify_credentials(db: Session, email: str, password: str) -> AdminAccount:
    """Raises InvalidCredentialsError. Returns the account on success."""
    account = db.get(AdminAccount, SINGLETON_ID)
    stored_hash = account.password_hash if account else _DUMMY_HASH

    # Always run bcrypt, and always check both, even when we already know
    # there's no account or the email is wrong - constant-time-ish, so
    # response timing doesn't hint at whether an account exists yet.
    password_ok = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    email_ok = account is not None and email == account.email

    if not (email_ok and password_ok):
        raise InvalidCredentialsError("Incorrect email or password.")
    return account


def create_access_token(email: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": email, "exp": expires_at}
    return jwt.encode(payload, _get_secret_key(), algorithm=ALGORITHM)


def _decode(token: str) -> str:
    """Returns the email from a valid token. Raises InvalidCredentialsError
    or AuthConfigError."""
    try:
        payload = jwt.decode(token, _get_secret_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise InvalidCredentialsError("Invalid or expired session.") from exc
    email = payload.get("sub")
    if not email:
        raise InvalidCredentialsError("Invalid session token.")
    return email


def require_auth(access_token: str | None = Cookie(default=None)) -> str:
    """FastAPI dependency for every protected endpoint - 401s on any failure
    so a misconfigured server fails closed, not open. Returns the logged-in
    email; no endpoint currently needs it, but it's there for the same
    reason a Depends() return value usually is."""
    if access_token is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        return _decode(access_token)
    except AuthError:
        raise HTTPException(status_code=401, detail="Not authenticated.")


def get_current_account(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> AdminAccount | None:
    """Soft check for GET /auth/me - never raises, just returns None."""
    if access_token is None:
        return None
    try:
        email = _decode(access_token)
    except AuthError:
        return None

    account = db.get(AdminAccount, SINGLETON_ID)
    if account is None or account.email != email:
        return None
    return account
