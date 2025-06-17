from sqlalchemy.orm import Session
from fastapi import HTTPException
from typing import List

from ..db import models, schemas

class ContactService:
    def search_users(self, db: Session, current_user_id: int, username_query: str, for_group:bool = False) -> List[models.User]:
        """
        Search for users by username, excluding the current user and users already in contacts.
        """
        if not username_query:
            return []
        
        exclude_ids = {current_user_id}
        if not for_group:
            existing_contact_friend_ids = db.query(models.Contact.friend_id).filter(models.Contact.user_id == current_user_id).all()
            existing_contact_user_ids = db.query(models.Contact.user_id).filter(models.Contact.friend_id == current_user_id).all()
            
            for fid in existing_contact_friend_ids:
                exclude_ids.add(fid[0])
            for uid in existing_contact_user_ids:
                exclude_ids.add(uid[0])

        return db.query(models.User).filter(
            models.User.username.contains(username_query),
            ~models.User.id.in_(exclude_ids) 
        ).all()

    def add_contact(self, db: Session, user_id: int, friend_id: int) -> models.Contact:
        """
        Add a contact relationship between two users.
        """
        if user_id == friend_id:
            raise HTTPException(status_code=400, detail="Cannot add yourself as a contact")

        friend_user = db.query(models.User).filter(models.User.id == friend_id).first()
        if not friend_user:
            raise HTTPException(status_code=404, detail="Friend user not found")

        existing_contact = db.query(models.Contact).filter(
            ((models.Contact.user_id == user_id) & (models.Contact.friend_id == friend_id)) |
            ((models.Contact.user_id == friend_id) & (models.Contact.friend_id == user_id))
        ).first()

        if existing_contact:
            raise HTTPException(status_code=400, detail="Contact already exists or request pending")

        db_contact = models.Contact(user_id=user_id, friend_id=friend_id)
        db.add(db_contact)
        db.commit()
        db.refresh(db_contact)
        return db_contact

    def get_contacts(self, db: Session, user_id: int) -> List[models.User]:
        """
        Retrieve all contacts (friends) for a given user.
        Returns a list of User objects.
        """
        contacts = db.query(models.Contact).filter(
            (models.Contact.user_id == user_id) | (models.Contact.friend_id == user_id)
        ).all()
        
        friend_ids = set()
        for contact in contacts:
            if contact.user_id == user_id:
                friend_ids.add(contact.friend_id)
            else:
                friend_ids.add(contact.user_id)
        
        if not friend_ids:
            return []
            
        return db.query(models.User).filter(models.User.id.in_(list(friend_ids))).all()
    
    def delete_contact(self, db: Session, user_id: int, friend_id: int) -> bool:
        contact_to_delete = db.query(models.Contact).filter(
            (
                (models.Contact.user_id == user_id) & (models.Contact.friend_id == friend_id)
            ) |
            (
                (models.Contact.user_id == friend_id) & (models.Contact.friend_id == user_id)
            )
        ).first()

        if contact_to_delete:
            db.delete(contact_to_delete)
            db.commit()
            return True
        return False

contact_service = ContactService()