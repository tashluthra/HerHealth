from app.db import SessionLocal
from app.repositories.user_repo import UserRepository
from app.security import hash_password
import uuid, pytest

def test_user_repo_create_and_get():
    db = SessionLocal()
    repo = UserRepository(db)
    email = f"{uuid.uuid4().hex[:8]}@ex.com"
    u = repo.create(email=email, name="Repo", password_hash=hash_password("StrongPassw0rd!"))
    assert u.id and u.email == email
    assert repo.get(u.id).email == email
    db.close()

def test_user_repo_unique_email_violation():
    db = SessionLocal()
    repo = UserRepository(db)
    email = f"{uuid.uuid4().hex[:8]}@ex.com"
    repo.create(email=email, name="A", password_hash=hash_password("StrongPassw0rd!"))
    with pytest.raises(ValueError):
        repo.create(email=email, name="B", password_hash=hash_password("StrongPassw0rd!"))
    db.close()
