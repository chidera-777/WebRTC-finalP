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
async def websocket_endpoint(websocket: WebSocket, user_id_str: str):
    try:
        user_id = int(user_id_str)
    except ValueError:
        print(f"Invalid user_id format: {user_id_str}. Connection rejected.")
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, user_id)
    username_for_log = f"user_{user_id}"

    try:
        while True:
            data = await websocket.receive_text()
            print(f"Message from {username_for_log} (ID: {user_id}): {data}")
            try:
                message_data = json.loads(data)
                msg_type = message_data.get("type")
                message_data["from_user_id"] = message_data.get("from_user_id", user_id)
                message_data["sender_username"] = message_data.get("sender_username")

                target_user_id_str = message_data.get("to") 
                target_user_id = None
                if target_user_id_str:
                    try:
                        target_user_id = int(target_user_id_str)
                    except ValueError:
                        print(f"Warning: Invalid target user_id format '{target_user_id_str}' in message from {user_id}")
                        
                        await manager.send_personal_message({"type":"error", "detail": f"Invalid target user_id: {target_user_id_str}"}, user_id)
                        continue 
                    
                call_signaling_types = [
                    "call_offer", "call_answer", "candidate", 
                    "call_rejected", "call_busy", "call_ended"
                ]
                
                if msg_type in call_signaling_types:
                    message_data["from"] = user_id

                if msg_type in call_signaling_types:
                    if target_user_id is not None:
                        await manager.send_personal_message(message_data, target_user_id)
                    else:
                        print(f"Warning: {msg_type} message from {user_id} without a target_user_id. Message: {message_data}")
                        await manager.send_personal_message({
                            "type": "error", 
                            "detail": f"{msg_type} requires a 'to' field specifying the target user ID."
                        }, user_id)
                elif msg_type == "chat_message":
                    print(f"Received direct chat_message from {user_id}, normally handled by HTTP endpoint.")
                    if target_user_id:
                        await manager.send_personal_message(message_data, target_user_id)
                    else: 
                        await manager.broadcast(message_data, sender_user_id=user_id)

                elif msg_type == "join": 
                    join_username = message_data.get("username", f"user_{user_id}") # Get username from message or use placeholder
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
        await manager.broadcast({"type": "user_left", "user_id": user_id, "username": username_for_log}) # Send username_for_log or actual username if available
    except Exception as e:
        print(f"Error with WebSocket for {user_id}: {e}")
        manager.disconnect(user_id)
        await manager.broadcast({"type": "user_left", "user_id": user_id, "username": username_for_log, "error": str(e)})


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()