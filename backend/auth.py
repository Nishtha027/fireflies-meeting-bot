"""
Multi-user auth for Meetscribe: open registration, real per-user accounts in
the `users` table, session state as a JWT (the user's id as `sub`) in an
httpOnly cookie.

require_auth() is the FastAPI dependency every protected endpoint depends on
(via the `protected` router for blanket coverage, and directly as a
parameter wherever an endpoint needs the resolved user to filter its own
data - which is nearly everywhere, since this app scopes almost every query
by "rows this user owns"). It 401s on any failure - missing cookie,
malformed/expired JWT, or a JWT for a user id that no longer exists - and
resolves to the actual User row, not just a boolean or an id.

get_current_user() is the soft variant GET /auth/me uses: never raises,
returns None on any failure, so that endpoint can always answer 200 with
authenticated=true/false rather than 401ing itself.
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
from app.models import User

load_dotenv()

COOKIE_NAME = "access_token"
ALGORITHM = "HS256"
# 7 days: convenience (no daily re-login) traded against exposure window (a
# leaked cookie is only useful for a week) - no refresh-token rotation in
# scope to justify going longer.
TOKEN_EXPIRE_DAYS = 7

# Checked when no user matches a login attempt, so verify_credentials()
# always does the same bcrypt work whether or not the email is registered -
# timing doesn't leak which emails exist.
_DUMMY_HASH = bcrypt.hashpw(b"no-such-user", bcrypt.gensalt()).decode("utf-8")


class AuthError(Exception):
    """Base class for auth failures - callers decide how to present them."""


class InvalidCredentialsError(AuthError):
    """Email/password didn't match any account, or the session cookie was
    missing/malformed/expired."""


class EmailAlreadyRegisteredError(AuthError):
    """POST /auth/register was called with an email that's already taken."""


class AuthConfigError(AuthError):
    """JWT_SECRET_KEY is not set."""


def _get_secret_key() -> str:
    try:
        return os.environ["JWT_SECRET_KEY"]
    except KeyError as exc:
        raise AuthConfigError("JWT_SECRET_KEY is not set - check backend/.env.") from exc


def register_user(db: Session, name: str, email: str, password: str) -> User:
    """Raises EmailAlreadyRegisteredError if the email is already taken.

    The up-front lookup gives a clean, fast 409 in the common case; the
    try/except around commit() is the real guarantee against a race (two
    registrations for the same email landing at once) - the email column's
    own UNIQUE constraint rejects the loser, which we turn into the same
    EmailAlreadyRegisteredError.
    """
    existing = db.query(User).filter_by(email=email).one_or_none()
    if existing is not None:
        raise EmailAlreadyRegisteredError("An account with this email already exists.")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = User(name=name, email=email, password_hash=password_hash)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise EmailAlreadyRegisteredError("An account with this email already exists.")
    db.refresh(user)
    return user


def verify_credentials(db: Session, email: str, password: str) -> User:
    """Raises InvalidCredentialsError. Returns the matching user on success."""
    user = db.query(User).filter_by(email=email).one_or_none()
    stored_hash = user.password_hash if user else _DUMMY_HASH

    # Always run bcrypt, even when there's no matching user - timing
    # doesn't hint at whether an email is registered.
    password_ok = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    if user is None or not password_ok:
        raise InvalidCredentialsError("Incorrect email or password.")
    return user


def verify_password(user: User, password: str) -> bool:
    """Plain password check against an already-resolved user - used
    wherever we need to re-confirm identity for an already-authenticated
    session (changing the password, deleting the account), as opposed to
    verify_credentials() above which is the email+password login lookup."""
    return bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))


def update_account(db: Session, user: User, name: str, email: str) -> User:
    """PATCH /settings/account: update the profile fields that don't need
    re-authentication (unlike change_password()/delete below). Raises
    EmailAlreadyRegisteredError if another account already owns the new
    email - the up-front lookup excludes the user's own row so re-saving
    their current email is never mistaken for a collision, and the
    try/except around commit() is the same race guard register_user() uses
    (two accounts claiming the same email at once)."""
    existing = db.query(User).filter(User.email == email, User.id != user.id).one_or_none()
    if existing is not None:
        raise EmailAlreadyRegisteredError("An account with this email already exists.")

    user.name = name
    user.email = email
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise EmailAlreadyRegisteredError("An account with this email already exists.")
    db.refresh(user)
    return user


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    """Raises InvalidCredentialsError if current_password doesn't match the
    account's actual password. Deliberately required even though the
    caller already has a valid session - an active-but-hijacked or
    left-open session must not be enough on its own to lock the real
    owner out by silently swapping the password."""
    if not verify_password(user, current_password):
        raise InvalidCredentialsError("Current password is incorrect.")
    user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    db.commit()


def create_access_token(user_id: int) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, _get_secret_key(), algorithm=ALGORITHM)


def _decode_user_id(token: str) -> int:
    try:
        payload = jwt.decode(token, _get_secret_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise InvalidCredentialsError("Invalid or expired session.") from exc
    sub = payload.get("sub")
    if not sub:
        raise InvalidCredentialsError("Invalid session token.")
    try:
        return int(sub)
    except ValueError:
        raise InvalidCredentialsError("Invalid session token.")


def require_auth(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency for every protected endpoint - 401s on any
    failure so a misconfigured server fails closed, not open. Resolves to
    the actual logged-in User row (not just a boolean), since almost every
    protected endpoint needs to filter its own data by who's asking."""
    if access_token is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        user_id = _decode_user_id(access_token)
    except AuthError:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user


def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Soft check for GET /auth/me - never raises, just returns None."""
    if access_token is None:
        return None
    try:
        user_id = _decode_user_id(access_token)
    except AuthError:
        return None
    return db.get(User, user_id)
