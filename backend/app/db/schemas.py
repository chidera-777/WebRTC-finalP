from pydantic import BaseModel, EmailStr
import datetime
from typing import Optional

class UserBase(BaseModel):
    username: str
    email: Optional[EmailStr] = None

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool

    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: int

class TokenData(BaseModel):
    username: Optional[str] = None


class ContactBase(BaseModel):
    friend_id: int

class ContactCreate(ContactBase):
    pass

class Contact(ContactBase):
    id: int
    user_id: int

    model_config = {"from_attributes": True}


class UserSearchResult(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}

class MessageBase(BaseModel):
    content: str

class MessageCreate(MessageBase):
    receiver_id: int

class Message(MessageBase):
    id: int
    sender_id: int
    receiver_id: int
    timestamp: datetime.datetime

    model_config = {"from_attributes": True}


class GroupBase(BaseModel):
    name: str

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    creator_id: int
    created_at: datetime.datetime
    creator: User 

    model_config = {"from_attributes": True}

class GroupMemberBase(BaseModel):
    user_id: int
    role: Optional[str] = "member"

class GroupMemberCreate(GroupMemberBase):
    group_id: int

class GroupMemberUpdate(BaseModel):
    role: str

class GroupMember(GroupMemberBase):
    id: int
    group_id: int
    joined_at: datetime.datetime
    user: User 

    model_config = {"from_attributes": True}

class GroupMessageBase(BaseModel):
    content: str

class GroupMessageCreate(GroupMessageBase):
    group_id: int

class GroupMessage(GroupMessageBase):
    id: int
    group_id: int
    sender_id: int
    timestamp: datetime.datetime
    sender_username: str

    model_config = {"from_attributes": True}


class GroupDetails(Group):
    members: list[GroupMember] = []
    messages: list[GroupMessage] = []

    model_config = {"from_attributes": True}