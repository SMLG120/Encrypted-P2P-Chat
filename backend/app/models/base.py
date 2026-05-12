"""
SQLAlchemy declarative base — imported by all model files.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
