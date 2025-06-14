from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import List

from ..db import models, schemas, database
from ..core.security import get_current_active_user
from ..services.message_service import message_service
from ..services.signaling_service import manager
import datetime

router = APIRouter(
    prefix="/messages",
    tags=["messages"],
    responses={404: {"description": "Not found"}},
)

@router.post("/", response_model=schemas.Message)
async def send_message_api(
    message_in: schemas.MessageCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    
    if current_user.id == message_in.receiver_id:
        raise HTTPException(status_code=400, detail="Cannot send message to yourself")

    db_message = message_service.create_message(db=db, sender_id=current_user.id, message_in=message_in)
    
    websocket_message = {
        "type": "chat_message",
        "id": db_message.id,
        "sender_id": db_message.sender_id,
        "receiver_id": db_message.receiver_id,
        "content": db_message.content,
        "timestamp": db_message.timestamp.isoformat() if isinstance(db_message.timestamp, datetime.datetime) else str(db_message.timestamp),
        "sender_username": current_user.username 
    }
    
    await manager.send_personal_message(websocket_message, message_in.receiver_id)
        
    return db_message

@router.get("/{friend_id}", response_model=List[schemas.Message])
def get_message_history_api(
    friend_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user),
    skip: int = 0,
    limit: int = 50
):
    messages = message_service.get_messages_between_users(
        db=db, user1_id=current_user.id, user2_id=friend_id, skip=skip, limit=limit
    )
    return messages