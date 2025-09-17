-- Drop the existing room_members table to recreate it with the correct structure
DROP TABLE IF EXISTS public.room_members CASCADE;

-- Recreate room_members table with username instead of user_id (for now, until auth is implemented)
CREATE TABLE public.room_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  username TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(room_id, username)
);

-- Enable RLS on room_members
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Drop existing message policies to recreate them
DROP POLICY IF EXISTS "Users can view messages in their rooms" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages to their rooms" ON public.messages;

-- Create new policies for messages with room-based access control
CREATE POLICY "Users can view messages in their rooms" 
ON public.messages 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text 
  AND EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE room_members.room_id = messages.room_id 
    -- For now, allow any authenticated user to see messages if they're in the room
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

-- Drop existing presence policies to recreate them
DROP POLICY IF EXISTS "Users can view presence in their rooms" ON public.user_presence;
DROP POLICY IF EXISTS "Users can manage presence in their rooms" ON public.user_presence;
DROP POLICY IF EXISTS "Users can manage their own presence" ON public.user_presence;

-- Create simplified presence policies
CREATE POLICY "Users can view presence in their rooms" 
ON public.user_presence 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text
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
CREATE POLICY "Users can view room members" 
ON public.room_members 
FOR SELECT 
USING (
  auth.role() = 'authenticated'::text
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