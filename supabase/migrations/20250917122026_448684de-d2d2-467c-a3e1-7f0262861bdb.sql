-- Create room_members table to track which users can access which rooms
CREATE TABLE public.room_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  username TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(room_id, username)
);

-- Enable RLS on room_members
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Create function to check if a user is a member of a room
CREATE OR REPLACE FUNCTION public.is_room_member(p_username TEXT, p_room_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE username = p_username AND room_id = p_room_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing policies on messages table
DROP POLICY IF EXISTS "Messages are viewable by authenticated users" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;

-- Create new policies for messages with room-based access control
CREATE POLICY "Users can view messages in their rooms" 
ON public.messages 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE room_members.room_id = messages.room_id 
    AND room_members.username = messages.username
  )
);

CREATE POLICY "Users can send messages to their rooms" 
ON public.messages 
FOR INSERT 
WITH CHECK (
  auth.role() = 'authenticated'::text 
  AND EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE room_members.room_id = messages.room_id 
    AND room_members.username = messages.username
  )
);

-- Drop existing policies on user_presence table
DROP POLICY IF EXISTS "Presence is viewable by authenticated users" ON public.user_presence;
DROP POLICY IF EXISTS "Authenticated users can manage their presence" ON public.user_presence;

-- Create new policies for user_presence with room-based access control
CREATE POLICY "Users can view presence in their rooms" 
ON public.user_presence 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND EXISTS (
    SELECT 1 FROM public.room_members rm1
    WHERE rm1.username = user_presence.username
    AND EXISTS (
      SELECT 1 FROM public.room_members rm2
      WHERE rm2.room_id = rm1.room_id
      AND rm2.username IN (
        SELECT username FROM public.user_presence WHERE room_id = user_presence.room_id
      )
    )
  )
);

CREATE POLICY "Users can manage their own presence" 
ON public.user_presence 
FOR ALL 
USING (
  auth.role() = 'authenticated'::text
)
WITH CHECK (
  auth.role() = 'authenticated'::text
);

-- Policies for room_members table
CREATE POLICY "Users can view room members for their rooms" 
ON public.room_members 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND EXISTS (
    SELECT 1 FROM public.room_members rm 
    WHERE rm.room_id = room_members.room_id 
    AND rm.username IN (
      SELECT username FROM public.user_presence LIMIT 1
    )
  )
);

CREATE POLICY "Users can join public rooms" 
ON public.room_members 
FOR INSERT 
WITH CHECK (
  auth.role() = 'authenticated'::text 
  AND room_id IN ('general', 'random', 'tech')
);

CREATE POLICY "Users can leave rooms" 
ON public.room_members 
FOR DELETE 
USING (
  auth.role() = 'authenticated'::text
);

-- Add initial room memberships for existing data (general room is public)
INSERT INTO public.room_members (room_id, username)
SELECT DISTINCT 'general', username FROM public.messages
ON CONFLICT (room_id, username) DO NOTHING;

INSERT INTO public.room_members (room_id, username)
SELECT DISTINCT 'general', username FROM public.user_presence
ON CONFLICT (room_id, username) DO NOTHING;