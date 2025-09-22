-- Add unique constraint to room_members to prevent duplicates
ALTER TABLE public.room_members 
ADD CONSTRAINT room_members_user_room_unique UNIQUE (user_id, room_id);

-- Add unique constraint to user_presence to prevent duplicates
ALTER TABLE public.user_presence 
ADD CONSTRAINT user_presence_user_room_unique UNIQUE (user_id, room_id);