from fastapi import WebSocket
from typing import Dict, List, Optional
import json
from sqlalchemy.orm import Session
from ..db import models

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.active_group_calls: Dict[int, List[int]] = {} 
        self.group_call_types: Dict[int, bool] = {}
        
    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        
        for group_id, participants in list(self.active_group_calls.items()):
            if user_id in participants:
                participants.remove(user_id)
                if not participants:                      
                    del self.active_group_calls[group_id]

    def is_user_connected(self, user_id: int) -> bool:
        """Check if a user is currently connected via WebSocket"""
        return user_id in self.active_connections

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            websocket = self.active_connections[user_id]
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                self.disconnect(user_id)

    async def broadcast(self, message: dict, sender_user_id: Optional[int] = None):
        """Broadcast message to all connected users except the sender"""
        for user_id, websocket in list(self.active_connections.items()):
            if sender_user_id and user_id == sender_user_id:
                continue              
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                self.disconnect(user_id)

    async def broadcast_to_group(self, db: Session, group_id: int, message: dict, sender_user_id: Optional[int] = None):
        """Broadcast message to all members of a specific group"""
        group_members = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).all()
        
        for member in group_members:
            if sender_user_id and member.user_id == sender_user_id:
                continue              
            if member.user_id in self.active_connections:
                try:
                    await self.active_connections[member.user_id].send_text(json.dumps(message))
                except Exception as e:
                    self.disconnect(member.user_id)

        
    async def start_group_call(self, group_id: int, user_id: int, is_video: bool = False):
        """Start a group call and track its type"""
        if group_id not in self.active_group_calls:
            self.active_group_calls[group_id] = []
        if user_id not in self.active_group_calls[group_id]:
            self.active_group_calls[group_id].append(user_id)
        self.group_call_types[group_id] = is_video  # Store call type
        return list(self.active_group_calls[group_id])
            
    def get_group_call_type(self, group_id: int) -> bool:
        return self.group_call_types.get(group_id, False)

    async def join_group_call(self, group_id: int, user_id: int):
        """Add a user to an active group call"""
        if group_id not in self.active_group_calls:
            self.active_group_calls[group_id] = []
        
        if user_id not in self.active_group_calls[group_id]:
            self.active_group_calls[group_id].append(user_id)
        
        return self.active_group_calls[group_id]  
    async def leave_group_call(self, group_id: int, user_id: int) -> str:
        """Remove a user from a group call. Returns 'ended' if call ended, 'left' if user just left"""
        if group_id in self.active_group_calls and user_id in self.active_group_calls[group_id]:
            self.active_group_calls[group_id].remove(user_id)
            
            if not self.active_group_calls[group_id]:
                del self.active_group_calls[group_id]
                if group_id in self.group_call_types:
                    del self.group_call_types[group_id]
                return "ended"
            else:
                return "left"
        
        return "not_in_call"

    def is_user_in_group_call(self, group_id: int, user_id: int) -> bool:
        """Check if a user is in a specific group call"""
        return group_id in self.active_group_calls and user_id in self.active_group_calls[group_id]

    def get_group_call_participants(self, group_id: int) -> List[int]:
        """Get list of active participants in a group call"""
        return self.active_group_calls.get(group_id, [])

    async def send_to_group_call_participants(self, group_id: int, message: dict, sender_user_id: Optional[int] = None):
        """Send message to all active participants in a group call"""
        if group_id not in self.active_group_calls:
            return

        participants = self.active_group_calls[group_id]
        for participant_id in participants:
            if sender_user_id and participant_id == sender_user_id:
                continue              
            if participant_id in self.active_connections:
                try:
                    await self.active_connections[participant_id].send_text(json.dumps(message))
                except Exception as e:
                    self.disconnect(participant_id)
                    if participant_id in self.active_group_calls[group_id]:
                        self.active_group_calls[group_id].remove(participant_id)

    def get_active_group_calls(self) -> Dict[int, List[int]]:
        """Get all active group calls"""
        return self.active_group_calls.copy()

    def get_group_call_count(self, group_id: int) -> int:
        """Get number of participants in a group call"""
        return len(self.active_group_calls.get(group_id, []))
    
    def is_group_call_active(self, group_id: int) -> bool:
        """Check if a group call is currently active"""
        return group_id in self.active_group_calls and len(self.active_group_calls[group_id]) > 0

    def get_group_call_participants(self, group_id: int) -> list:
        """Get list of participants in a group call"""
        return list(self.active_group_calls.get(group_id, []))

    async def join_ongoing_group_call(self, group_id: int, user_id: int):
        """Allow user to join an ongoing group call"""
        if not self.is_group_call_active(group_id):
            return False
       
        if group_id not in self.active_group_calls:
            self.active_group_calls[group_id] = []
        
        if user_id not in self.active_group_calls[group_id]:
            self.active_group_calls[group_id].append(user_id)
            return True
        return False

manager = ConnectionManager()