-- Create room_members table to track which users can access which rooms
CREATE TABLE public.room_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, room_id)
);

-- Enable RLS on room_members
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Create function to check if a user is a member of a room
CREATE OR REPLACE FUNCTION public.is_room_member(p_user_id UUID, p_room_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- General room is always accessible to all authenticated users
  IF p_room_id = 'general' THEN
    RETURN TRUE;
  END IF;
  
  -- Check if user is a member of the room
  RETURN EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE user_id = p_user_id AND room_id = p_room_id
  );
END;
$$;

-- Update messages RLS policies to check room membership
DROP POLICY IF EXISTS "Messages are viewable by authenticated users" ON public.messages;
CREATE POLICY "Users can view messages in their rooms" 
ON public.messages 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND public.is_room_member(auth.uid(), room_id)
);

DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
CREATE POLICY "Users can send messages to their rooms" 
ON public.messages 
FOR INSERT 
WITH CHECK (
  auth.role() = 'authenticated'::text 
  AND public.is_room_member(auth.uid(), room_id)
);

-- Update user_presence RLS policies to check room membership
DROP POLICY IF EXISTS "Presence is viewable by authenticated users" ON public.user_presence;
CREATE POLICY "Users can view presence in their rooms" 
ON public.user_presence 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND public.is_room_member(auth.uid(), room_id)
);

DROP POLICY IF EXISTS "Authenticated users can manage their presence" ON public.user_presence;
CREATE POLICY "Users can manage presence in their rooms" 
ON public.user_presence 
FOR ALL 
USING (
  auth.role() = 'authenticated'::text 
  AND public.is_room_member(auth.uid(), room_id)
)
WITH CHECK (
  auth.role() = 'authenticated'::text 
  AND public.is_room_member(auth.uid(), room_id)
);

-- RLS policies for room_members table
CREATE POLICY "Users can view their room memberships" 
ON public.room_members 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view room members in their rooms" 
ON public.room_members 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.room_members rm 
    WHERE rm.user_id = auth.uid() 
    AND rm.room_id = room_members.room_id
  )
);

-- Allow users to join public rooms (for now, only 'general' is public)
CREATE POLICY "Users can join public rooms" 
ON public.room_members 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id 
  AND room_id = 'general'
);