from sqlalchemy.orm import Session
from typing import List, Optional
from ..db import models, schemas
from sqlalchemy import or_, and_

class MessageService:
    def create_message(self, db: Session, *, sender_id: int, message_in: schemas.MessageCreate) -> models.Message:
        db_message = models.Message(
            sender_id=sender_id,
            receiver_id=message_in.receiver_id,
            content=message_in.content
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)
        return db_message

    def get_messages_between_users(
        self, db: Session, *, user1_id: int, user2_id: int, skip: int = 0, limit: int = 100
    ) -> List[models.Message]:
        return (
            db.query(models.Message)
            .filter(
                or_(
                    and_(models.Message.sender_id == user1_id, models.Message.receiver_id == user2_id),
                    and_(models.Message.sender_id == user2_id, models.Message.receiver_id == user1_id),
                )
            )
            .order_by(models.Message.timestamp.asc())
            .offset(skip)
            .limit(limit)
            .all()
        )

message_service = MessageService()