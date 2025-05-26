from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..db import database, models, schemas
from ..core import security
from ..services.signaling_service import manager
import datetime
import json

router = APIRouter(
    prefix="/groups",
    tags=["groups"],
)


def get_group_or_404(db: Session, group_id: int):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group

def is_user_group_admin(db: Session, group_id: int, user_id: int) -> bool:
    member_admin_check = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user_id,
        models.GroupMember.role == "admin"
    ).first()
    return True if member_admin_check else False

def require_group_admin(db: Session, group_id: int, current_user_id: int):
    if not is_user_group_admin(db, group_id, current_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not an admin of this group or action not permitted")


@router.post("/", response_model=schemas.Group)
def create_group(group_create: schemas.GroupCreate, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    db_group = models.Group(name=group_create.name, creator_id=current_user.id)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    db_group_member = models.GroupMember(group_id=db_group.id, user_id=current_user.id, role="admin")
    db.add(db_group_member)
    db.commit()
    return db_group

@router.get("/", response_model=List[schemas.Group])
def list_user_groups(db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    user_groups = db.query(models.Group).join(models.GroupMember).filter(models.GroupMember.user_id == current_user.id).all()
    return user_groups

@router.get("/{group_id}", response_model=schemas.GroupDetails)
def get_group_details(group_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == current_user.id).first()
    if not member_check:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this group")
    
    return group

@router.put("/{group_id}", response_model=schemas.Group)
def update_group(group_id: int, group_update: schemas.GroupBase, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    require_group_admin(db, group_id, current_user.id)
    
    group.name = group_update.name
    db.commit()
    db.refresh(group)
    return group

@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    require_group_admin(db, group_id, current_user.id)
    member_count = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).count()
    if member_count > 0:
        if member_count == 1 and current_user.id == group.creator_id:
            db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).delete(synchronize_session=False)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group cannot be deleted because it still has members. Please remove all members before deleting the group."
            )
        
    db.query(models.GroupMessage).filter(models.GroupMessage.group_id == group_id).delete(synchronize_session=False)
    db.delete(group)
    db.commit()
    return


@router.post("/{group_id}/members", response_model=schemas.GroupMember)
def add_group_member(group_id: int, member_create: schemas.GroupMemberBase, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    require_group_admin(db, group_id, current_user.id)
    user_to_add = db.query(models.User).filter(models.User.id == member_create.user_id).first()
    if not user_to_add:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User to add not found")

    existing_member = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == member_create.user_id).first()
    if existing_member:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of this group")

    db_member = models.GroupMember(group_id=group_id, user_id=member_create.user_id, role=member_create.role)
    db.add(db_member)
    db.commit()
    db.refresh(db_member)
    return db_member

@router.get("/{group_id}/members", response_model=List[schemas.GroupMember])
def list_group_members(group_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == current_user.id).first()
    if not member_check:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this group")

    members = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).all()
    return members

@router.delete("/{group_id}/members/{user_id_to_remove}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_member(group_id: int, user_id_to_remove: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    member_to_remove = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id, 
        models.GroupMember.user_id == user_id_to_remove
    ).first()

    if not member_to_remove:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found in this group")

    current_user_is_admin = is_user_group_admin(db, group_id, current_user.id)
    if current_user_is_admin:
        if user_id_to_remove == current_user.id:
            other_admins_count = db.query(models.GroupMember).filter(
                models.GroupMember.group_id == group_id, 
                models.GroupMember.role == "admin", 
                models.GroupMember.user_id != current_user.id
            ).count()
            if other_admins_count == 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the only admin. Transfer admin role or delete the group.")
    else:
        if user_id_to_remove != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to remove this member. Only admins or the user themselves can perform this action.")

    db.delete(member_to_remove)
    db.commit()
    return

@router.put("/{group_id}/members/{user_id_to_update}", response_model=schemas.GroupMember)
def update_group_member_role(group_id: int, user_id_to_update: int, role_update: schemas.GroupMemberUpdate, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    require_group_admin(db, group_id, current_user.id)
    member_to_update = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id_to_update).first()
    if not member_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    member_to_update.role = role_update.role
    db.commit()
    db.refresh(member_to_update)
    return member_to_update


# --- Group Messaging Endpoints ---

@router.post("/{group_id}/messages", response_model=schemas.GroupMessage)
async def send_group_message(group_id: int, message_create: schemas.GroupMessageBase, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == current_user.id).first()
    if not member_check:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this group and cannot send messages")

    db_message = models.GroupMessage(**message_create.dict(), group_id=group_id, sender_id=current_user.id, sender_username=current_user.username)
    db.add(db_message)
    db.commit()
    db.refresh(db_message)

    message_data = schemas.GroupMessage.from_orm(db_message).dict()
    message_data['type'] = 'group_message'
    if isinstance(message_data.get('timestamp'), datetime.datetime):
        message_data['timestamp'] = message_data['timestamp'].isoformat()
    await manager.broadcast_to_group(db, group_id, message_data, sender_user_id=current_user.id)
    
    return db_message

@router.get("/{group_id}/messages", response_model=List[schemas.GroupMessage])
def get_group_messages(group_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(database.get_db), current_user: models.User = Depends(security.get_current_active_user)):
    group = get_group_or_404(db, group_id)
    member_check = db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == current_user.id).first()
    if not member_check:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this group and cannot view messages")

    messages = db.query(models.GroupMessage).filter(models.GroupMessage.group_id == group_id).order_by(models.GroupMessage.timestamp.asc()).offset(skip).limit(limit).all()
    return messages
