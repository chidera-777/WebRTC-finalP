from fastapi import WebSocket
from typing import Dict, List, Set
import json
from sqlalchemy.orm import Session
from ..db import models

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            print(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: dict, user_id: int):
        target_user_id = int(user_id) 
        if target_user_id in self.active_connections:
            websocket = self.active_connections[target_user_id]
            await websocket.send_text(json.dumps(message))
        else:
            print(f"User {target_user_id} not found for personal message: {message}")

    async def broadcast(self, message: dict, sender_user_id: int = None):
        for user_id, websocket in self.active_connections.items():
            if sender_user_id and user_id == sender_user_id:
                continue
            await websocket.send_text(json.dumps(message))

    async def broadcast_to_group(self, db: Session, group_id: int, message: dict, sender_user_id: int = None):
        group_members = db.query(models.GroupMember.user_id).filter(models.GroupMember.group_id == group_id).all()
        member_user_ids = {member.user_id for member in group_members}

        for user_id, websocket in self.active_connections.items():
            if user_id in member_user_ids:
                if sender_user_id and user_id == sender_user_id:
                    continue
                try:
                    await websocket.send_text(json.dumps(message))
                except Exception as e:
                    print(f"Error sending message to user {user_id} in group {group_id}: {e}")

manager = ConnectionManager()