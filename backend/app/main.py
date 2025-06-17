from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import models, database, schemas
from .api import auth, contacts_router, messages_router, group_router
from .core.security import get_current_active_user
from .services.signaling_service import manager
import json

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(contacts_router.router)
app.include_router(messages_router.router)
app.include_router(group_router.router)


async def notify_user_of_ongoing_calls(db: Session, user_id: int):
    """Notify user of ongoing group calls in their groups when they connect"""
    try:
        user_groups = db.query(models.GroupMember).filter(
            models.GroupMember.user_id == user_id
        ).all()
        
        ongoing_calls = []
        for group_membership in user_groups:
            group_id = group_membership.group_id
            if manager.is_group_call_active(group_id):
                group = db.query(models.Group).filter(models.Group.id == group_id).first()
                if group:
                    participants = manager.get_group_call_participants(group_id)
                    call_info = {
                        'groupId': group_id,
                        'groupName': group.name,
                        'participants': participants,
                        'participantCount': len(participants),
                        'isVideo': manager.get_group_call_type(group_id)
                    }
                    ongoing_calls.append(call_info)
        
        if ongoing_calls:
            notification = {
                'type': 'ongoing-group-calls',
                'calls': ongoing_calls
            }
            await manager.send_personal_message(notification, user_id)
            
    except Exception as e:
        print(f"Error notifying user {user_id} of ongoing calls: {e}")
        

@app.get("/")
def read_root():
    return {"message": "WebRTC Signaling Server is running"}


@app.websocket("/ws/{user_id_str}")
async def websocket_endpoint(websocket: WebSocket, user_id_str: str, db: Session = Depends(database.get_db)):
    try:
        user_id = int(user_id_str)
    except ValueError:
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, user_id)
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    username_for_log = db_user.username if db_user else f"user_{user_id}"
    
    await notify_user_of_ongoing_calls(db, user_id)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message_data = json.loads(data)
                msg_type = message_data.get("type")
                
                if db_user and 'sender_username' not in message_data:
                    message_data["sender_username"] = db_user.username

                target_user_id_str = message_data.get("to") or message_data.get("targetUserId")
                target_user_id = None
                if target_user_id_str:
                    try:
                        target_user_id = int(target_user_id_str)
                    except ValueError:
                        await manager.send_personal_message({"type":"error", "detail": f"Invalid target user_id: {target_user_id_str}"}, user_id)
                        continue
                
                group_id_str = message_data.get("groupId")
                group_id = None
                if group_id_str:
                    try:
                        group_id = int(group_id_str)
                    except ValueError:
                        await manager.send_personal_message({"type":"error", "detail": f"Invalid groupId: {group_id_str}"}, user_id)
                        continue

                call_signaling_types = [
                    "call_offer", "call_answer", "candidate", 
                    "call_rejected", "call_busy", "call_ended"
                ]
                group_call_signaling_types = [
                    "group-call-start", "group-call-offer", "group-call-answer",
                    "group-call-join", "group-call-leave", "group-call-user-joined", "group-call-ended", "group-call-busy"
                ]

                if msg_type in call_signaling_types:
                    message_data["from"] = user_id
                    if target_user_id is not None:
                        await manager.send_personal_message(message_data, target_user_id)
                    else:
                        await manager.send_personal_message({
                            "type": "error", 
                            "detail": f"{msg_type} requires a 'to' or 'targetUserId' field specifying the target user ID."
                        }, user_id)
                
                elif msg_type in group_call_signaling_types:
                    if not group_id:
                        await manager.send_personal_message({"type":"error", "detail": f"{msg_type} requires a 'groupId' field."}, user_id)
                        continue

                    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id).first()
                    if not member_check:
                        await manager.send_personal_message({"type":"error", "detail": f"You are not a member of group {group_id}."}, user_id)
                        continue
                    
                    message_data['groupId'] = group_id               
                    message_data['userId'] = user_id                     
                    message_data['sender_username'] = username_for_log 
                    is_video = message_data.get('isVideo', False)
                    if msg_type == "group-call-start":
                        await manager.start_group_call(group_id, user_id, is_video)
    
                        group_members = db.query(models.GroupMember).filter(
                            models.GroupMember.group_id == group_id,
                            models.GroupMember.user_id != user_id
                        ).all()
                        
                        start_notification = {
                            'type': 'group-call-start',
                            'userId': user_id,
                            'sender_username': username_for_log,
                            'groupId': group_id,
                            'groupName': message_data.get('groupName'),
                            'isVideo': message_data.get('isVideo', False),
                            'recipients': message_data.get('recipients', [])
                        }
                        
                        for member in group_members:
                            if manager.is_user_connected(member.user_id):
                                await manager.send_personal_message(start_notification, member.user_id)

                    elif msg_type == "group-call-join":
                        active_participants = await manager.join_group_call(group_id, user_id)
                        
                        join_notification = {
                            'type': 'group-call-join',
                            'userId': user_id,
                            'sender_username': username_for_log,
                            'groupId': group_id,
                            'groupName': message_data.get('groupName'),
                            'isVideo': message_data.get('isVideo', False),
                            'activeParticipants': active_participants,
                        }
                        await manager.send_to_group_call_participants(group_id, join_notification, sender_user_id=user_id)

                    elif msg_type == "group-call-leave":
                        status = await manager.leave_group_call(group_id, user_id)
                        if status == "ended":
                            end_notification = {
                                'type': 'group-call-ended',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id,
                                'reason': 'Last participant left the call'
                            }
                            await manager.broadcast_to_group(db, group_id, end_notification)
                        elif status == "left":
                            leave_notification = {
                                'type': 'group-call-leave',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id
                            }
                            await manager.send_to_group_call_participants(group_id, leave_notification, sender_user_id=user_id)
                            
                    elif msg_type == "group-call-busy":
                        if target_user_id:
                            busy_notification = {
                                'type': 'group-call-busy',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id,
                                'to': target_user_id,
                                'reason': message_data.get('reason', 'User is busy')
                            }
                            await manager.send_personal_message(busy_notification, target_user_id)
                        else:
                            busy_notification = {
                                'type': 'group-call-busy',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id,
                                'reason': message_data.get('reason', 'User is busy')
                            }
                            await manager.send_to_group_call_participants(group_id, busy_notification, sender_user_id=user_id)
                    
                    elif msg_type == "group-call-offer":
                        if not manager.is_user_in_group_call(group_id, user_id):
                            await manager.join_group_call(group_id, user_id)
                        
                        if target_user_id:
                            await manager.send_personal_message(message_data, target_user_id)
                        else:
                            await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                    
                    elif msg_type == "group-call-answer":
                        if target_user_id:
                            await manager.send_personal_message(message_data, target_user_id)
                        else:
                            await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                        
                    elif msg_type == "candidate":
                        if group_id:
                                await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                        elif target_user_id:
                            await manager.send_personal_message(message_data, target_user_id)
                        else:
                            await manager.send_personal_message({
                                "type": "error", 
                                "detail": "ICE candidate requires either 'to' field or 'groupId' field."
                            }, user_id)
                    
                    else:
                        await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)

                elif msg_type == "chat_message":
                    if target_user_id:
                        await manager.send_personal_message(message_data, target_user_id)
                    else: 
                        await manager.broadcast(message_data, sender_user_id=user_id)

                elif msg_type == "join": 
                    join_username = message_data.get("username", username_for_log) 
                    await manager.broadcast({"type": "user_joined", "user_id": user_id, "username": join_username}, sender_user_id=user_id)
                else:
                    await manager.broadcast(message_data, sender_user_id=user_id)
            except json.JSONDecodeError:
                await manager.broadcast({"type": "text", "from_user_id": user_id, "content": data}, sender_user_id=user_id)
            except Exception as e:
                await manager.send_personal_message({"type":"error", "detail": f"Error processing your message: {str(e)}"}, user_id)

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        for group_id_active, members in list(manager.active_group_calls.items()):
            if user_id in members:
                status = await manager.leave_group_call(group_id_active, user_id)                 
                if status == "ended":
                    disconnect_notification = {
                        'type': 'group-call-ended',
                        'groupId': group_id_active,
                        'reason': f'{username_for_log} disconnected, ending the call.'
                    }
                    await manager.broadcast_to_group(db, group_id_active, disconnect_notification)
                elif status == "left":
                    disconnect_notification = {
                        'type': 'group-call-leave',
                        'userId': user_id,
                        'sender_username': username_for_log, 
                        'groupId': group_id_active
                    }
                    await manager.send_to_group_call_participants(group_id_active, disconnect_notification, sender_user_id=user_id)
        await manager.broadcast({"type": "user_left", "user_id": user_id, "username": username_for_log})
    except Exception as e:
        manager.disconnect(user_id)
        await manager.broadcast({"type": "user_left", "user_id": user_id, "username": username_for_log, "error": str(e)})