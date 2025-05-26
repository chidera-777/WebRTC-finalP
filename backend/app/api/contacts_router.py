from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..db import models, schemas, database
from ..core.security import get_current_active_user
from ..services.contact_service import contact_service

router = APIRouter(
    prefix="/contacts",
    tags=["contacts"],
    responses={404: {"description": "Not found"}},
)


@router.get("/search", response_model=List[schemas.UserSearchResult])
def search_users_api(
    query: str, 
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Search for users by username.
    """
    if not query.strip():
        raise HTTPException(status_code=400, detail="Search query cannot be empty")
    users = contact_service.search_users(db=db, current_user_id=current_user.id, username_query=query)
    return users

@router.post("/add", response_model=schemas.Contact)
def add_contact_api(
    contact_in: schemas.ContactCreate, 
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Add a user to the contact list.
    """
    friend_user = db.query(models.User).filter(models.User.id == contact_in.friend_id).first()
    if not friend_user:
        raise HTTPException(status_code=404, detail="Friend user not found")

    return contact_service.add_contact(db=db, user_id=current_user.id, friend_id=contact_in.friend_id)

@router.get("/", response_model=List[schemas.UserSearchResult])
def list_contacts_api(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    List all contacts for the current user.
    """
    contacts = contact_service.get_contacts(db=db, user_id=current_user.id)
    return contacts

@router.delete("/{friend_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact_api(
    friend_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """
    Delete a contact from the current user's contact list.
    """
    success = contact_service.delete_contact(db=db, user_id=current_user.id, friend_id=friend_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found or not deletable.")
    return