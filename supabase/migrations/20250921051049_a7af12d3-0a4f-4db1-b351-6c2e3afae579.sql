-- Fix the room membership issues and ensure general room access
-- First, ensure all authenticated users are members of the general room
INSERT INTO public.room_members (room_id, user_id)
SELECT 'general', id FROM auth.users
ON CONFLICT DO NOTHING;

-- Update the is_room_member function to properly handle general room
CREATE OR REPLACE FUNCTION public.is_room_member(p_user_id uuid, p_room_id text)
RETURNS boolean
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

-- Create a trigger to automatically add new users to the general room
CREATE OR REPLACE FUNCTION public.add_user_to_general_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Add the new user to the general room
  INSERT INTO public.room_members (room_id, user_id)
  VALUES ('general', NEW.id)
  ON CONFLICT DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger for adding users to general room
DROP TRIGGER IF EXISTS on_auth_user_created_add_to_general ON auth.users;
CREATE TRIGGER on_auth_user_created_add_to_general
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.add_user_to_general_room();

-- Fix RLS policies for messages to handle general room properly
DROP POLICY IF EXISTS "Users can view messages in their rooms" ON public.messages;
CREATE POLICY "Users can view messages in their rooms" 
ON public.messages 
FOR SELECT 
USING (
  room_id = 'general' -- General room is accessible to all authenticated users
  OR EXISTS (
    SELECT 1 FROM room_members 
    WHERE room_members.room_id = messages.room_id 
    AND room_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can send messages to their rooms" ON public.messages;
CREATE POLICY "Users can send messages to their rooms" 
ON public.messages 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL 
  AND user_id = auth.uid() 
  AND (
    room_id = 'general' -- General room is accessible to all authenticated users
    OR EXISTS (
      SELECT 1 FROM room_members 
      WHERE room_members.room_id = messages.room_id 
      AND room_members.user_id = auth.uid()
    )
  )
);

-- Fix RLS policies for room_members to handle general room
DROP POLICY IF EXISTS "Users can view room members for their rooms" ON public.room_members;
CREATE POLICY "Users can view room members for their rooms" 
ON public.room_members 
FOR SELECT 
USING (
  room_id = 'general' -- Everyone can see general room members
  OR EXISTS (
    SELECT 1 FROM room_members rm 
    WHERE rm.room_id = room_members.room_id 
    AND rm.user_id = auth.uid()
  )
);

-- Enable realtime for all message tables
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE anonymous_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_members;

-- Set replica identity for realtime updates
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE anonymous_messages REPLICA IDENTITY FULL;
ALTER TABLE user_presence REPLICA IDENTITY FULL;
ALTER TABLE rooms REPLICA IDENTITY FULL;
ALTER TABLE room_members REPLICA IDENTITY FULL;