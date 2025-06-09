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

# CORS middleware
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


@app.get("/")
def read_root():
    return {"message": "WebRTC Signaling Server is running"}


@app.websocket("/ws/{user_id_str}")
async def websocket_endpoint(websocket: WebSocket, user_id_str: str, db: Session = Depends(database.get_db)):
    try:
        user_id = int(user_id_str)
    except ValueError:
        print(f"Invalid user_id format: {user_id_str}. Connection rejected.")
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, user_id)
    # Attempt to get username from a reliable source if possible, e.g., from a token or DB lookup
    # For now, we'll rely on the client sending it or use a placeholder.
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    username_for_log = db_user.username if db_user else f"user_{user_id}"

    try:
        while True:
            data = await websocket.receive_text()
            print(f"Message from {username_for_log} (ID: {user_id}): {data}")
            try:
                message_data = json.loads(data)
                msg_type = message_data.get("type")
                
                # Ensure sender information is present
                if db_user and 'sender_username' not in message_data:
                    message_data["sender_username"] = db_user.username

                target_user_id_str = message_data.get("to") or message_data.get("targetUserId")
                target_user_id = None
                if target_user_id_str:
                    try:
                        target_user_id = int(target_user_id_str)
                    except ValueError:
                        print(f"Warning: Invalid target user_id format '{target_user_id_str}' in message from {user_id}")
                        await manager.send_personal_message({"type":"error", "detail": f"Invalid target user_id: {target_user_id_str}"}, user_id)
                        continue
                
                group_id_str = message_data.get("groupId")
                group_id = None
                if group_id_str:
                    try:
                        group_id = int(group_id_str)
                    except ValueError:
                        print(f"Warning: Invalid groupId format '{group_id_str}' in message from {user_id}")
                        await manager.send_personal_message({"type":"error", "detail": f"Invalid groupId: {group_id_str}"}, user_id)
                        continue

                # Call signaling types (1-on-1)
                call_signaling_types = [
                    "call_offer", "call_answer", "candidate", 
                    "call_rejected", "call_busy", "call_ended"
                ]
                # Group call signaling types
                group_call_signaling_types = [
                    "group-call-start", "group-call-offer", "group-call-answer", "group-ice-candidate",
                    "group-call-join", "group-call-leave", "group-call-user-joined", "group-call-ended", "group-call-busy"
                ]

                if msg_type in call_signaling_types:
                    message_data["from"] = user_id
                    if target_user_id is not None:
                        await manager.send_personal_message(message_data, target_user_id)
                    else:
                        print(f"Warning: {msg_type} message from {user_id} without a target_user_id. Message: {message_data}")
                        await manager.send_personal_message({
                            "type": "error", 
                            "detail": f"{msg_type} requires a 'to' or 'targetUserId' field specifying the target user ID."
                        }, user_id)
                
                elif msg_type in group_call_signaling_types:
                    if not group_id:
                        print(f"Error: {msg_type} received without groupId from user {user_id}")
                        await manager.send_personal_message({"type":"error", "detail": f"{msg_type} requires a 'groupId' field."}, user_id)
                        continue

                    # Optional: Validate group membership
                    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id).first()
                    if not member_check:
                        print(f"User {user_id} ({username_for_log}) attempted {msg_type} for group {group_id} but is not a member.")
                        await manager.send_personal_message({"type":"error", "detail": f"You are not a member of group {group_id}."}, user_id)
                        continue
                    
                    message_data['groupId'] = group_id # Ensure groupId is in the message
                    message_data['userId'] = user_id # Ensure userId is in the message
                    message_data['sender_username'] = username_for_log # Ensure sender_username is in the message

                    if msg_type == "group-call-start":
                        # New handler for group call start
                        print(f"User {user_id} ({username_for_log}) started group call for group {group_id}")
                        
                        # Initialize the group call with the initiator
                        await manager.start_group_call(group_id, user_id)
                        
                        # Get all group members except the initiator
                        group_members = db.query(models.GroupMember).filter(
                            models.GroupMember.group_id == group_id,
                            models.GroupMember.user_id != user_id
                        ).all()
                        
                        # Create notification message with recipient list
                        start_notification = {
                            'type': 'group-call-start',
                            'userId': user_id,
                            'sender_username': username_for_log,
                            'groupId': group_id,
                            'isVideo': message_data.get('isVideo', False),
                            'recipients': message_data.get('recipients', [])
                        }
                        
                        # Send start notification to all group members except initiator
                        for member in group_members:
                            if manager.is_user_connected(member.user_id):
                                await manager.send_personal_message(start_notification, member.user_id)
                                print(f"Sent group call start notification to user {member.user_id}")

                    elif msg_type == "group-call-join":
                        active_participants = await manager.join_group_call(group_id, user_id)
                        
                        # Notify other participants that a new user joined
                        join_notification = {
                            'type': 'group-call-join',
                            'userId': user_id,
                            'sender_username': username_for_log,
                            'groupId': group_id,
                            'isVideo': message_data.get('isVideo', False),
                            'activeParticipants': active_participants,
                            'joinTime': message_data.get('joinTime')
                        }
                        await manager.send_to_group_call_participants(group_id, join_notification, sender_user_id=user_id)
                        print(f"User {user_id} ({username_for_log}) joined group call {group_id}, active participants: {active_participants}")

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
                            print(f"Group call {group_id} ended - last participant left")
                        elif status == "left":
                            leave_notification = {
                                'type': 'group-call-leave',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id
                            }
                            await manager.send_to_group_call_participants(group_id, leave_notification, sender_user_id=user_id)
                            print(f"User {user_id} ({username_for_log}) left group call {group_id}")
                            
                    elif msg_type == "group-call-busy":
                        # Handle busy response for group calls
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
                            # Broadcast busy to all call participants if no specific target
                            busy_notification = {
                                'type': 'group-call-busy',
                                'userId': user_id,
                                'sender_username': username_for_log,
                                'groupId': group_id,
                                'reason': message_data.get('reason', 'User is busy')
                            }
                            await manager.send_to_group_call_participants(group_id, busy_notification, sender_user_id=user_id)
                    
                    elif msg_type == "group-call-offer":
                        # Ensure user is in the group call before processing offers
                        if not manager.is_user_in_group_call(group_id, user_id):
                            await manager.join_group_call(group_id, user_id)
                        
                        # Send offer to specific target if specified, otherwise to group
                        if target_user_id:
                            await manager.send_personal_message(message_data, target_user_id)
                            print(f"Sent group call offer from {user_id} to {target_user_id} in group {group_id}")
                        else:
                            await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                            print(f"Broadcast group call offer from {user_id} to group {group_id}")
                    
                    elif msg_type == "group-call-answer":
                        # Answer is usually for a specific peer (the one who sent offer)
                        if target_user_id:
                            await manager.send_personal_message(message_data, target_user_id)
                            print(f"Sent group call answer from {user_id} to {target_user_id} in group {group_id}")
                        else:
                            await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                            print(f"Broadcast group call answer from {user_id} to group {group_id}")
                    
                    elif msg_type == "group-ice-candidate":
                        # ICE candidates for group calls - broadcast to all participants
                        await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                        
                    elif msg_type == "candidate":
                        # Handle both 1-on-1 and group call ICE candidates
                        if group_id:
                            # Group call ICE candidate - send to all participants
                            await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)
                        elif target_user_id:
                            # 1-on-1 ICE candidate - send to specific user
                            await manager.send_personal_message(message_data, target_user_id)
                        else:
                            print(f"Warning: ICE candidate from {user_id} without target or group")
                            await manager.send_personal_message({
                                "type": "error", 
                                "detail": "ICE candidate requires either 'to' field or 'groupId' field."
                            }, user_id)
                    
                    else:
                        # For other group call messages, relay to active participants
                        await manager.send_to_group_call_participants(group_id, message_data, sender_user_id=user_id)

                elif msg_type == "chat_message": # Existing 1-on-1 chat (if still used over WS)
                    print(f"Received direct chat_message from {user_id}, normally handled by HTTP endpoint.")
                    if target_user_id:
                        await manager.send_personal_message(message_data, target_user_id)
                    else: 
                        await manager.broadcast(message_data, sender_user_id=user_id)

                elif msg_type == "join": 
                    # This is the initial WebSocket join, not a group call join
                    join_username = message_data.get("username", username_for_log) 
                    await manager.broadcast({"type": "user_joined", "user_id": user_id, "username": join_username}, sender_user_id=user_id)
                else:
                    print(f"Broadcasting generic/unknown message type '{msg_type}' from {user_id}")
                    await manager.broadcast(message_data, sender_user_id=user_id)
            except json.JSONDecodeError:
                print(f"Error decoding JSON from {user_id}: {data}")
                await manager.broadcast({"type": "text", "from_user_id": user_id, "content": data}, sender_user_id=user_id)
            except Exception as e:
                print(f"Error processing message from {user_id}: {e}. Data: {data}")
                await manager.send_personal_message({"type":"error", "detail": f"Error processing your message: {str(e)}"}, user_id)

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        # Notify group call participants if the user was in any call
        # Iterate through a copy of items if modifying the dict during iteration
        for group_id_active, members in list(manager.active_group_calls.items()):
            if user_id in members:
                status = await manager.leave_group_call(group_id_active, user_id) # Clean up active_group_calls state
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
        print(f"Error with WebSocket for {user_id}: {e}")
        manager.disconnect(user_id)
        await manager.broadcast({"type": "user_left", "user_id": user_id, "username": username_for_log, "error": str(e)})