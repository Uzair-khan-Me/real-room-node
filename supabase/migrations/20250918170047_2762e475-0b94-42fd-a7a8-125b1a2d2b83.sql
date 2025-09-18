-- Create a rooms table for managing all rooms including private ones
CREATE TABLE public.rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('public', 'private')),
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  room_code TEXT UNIQUE -- For private rooms only
);

-- Enable RLS on rooms
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Insert default public rooms
INSERT INTO public.rooms (id, name, type) VALUES 
  ('general', 'general', 'public'),
  ('random', 'random', 'public'),
  ('tech', 'tech', 'public');

-- Create policies for rooms
CREATE POLICY "Anyone can view public rooms" 
ON public.rooms 
FOR SELECT 
USING (type = 'public');

CREATE POLICY "Users can view private rooms they're members of" 
ON public.rooms 
FOR SELECT 
USING (
  type = 'private' AND 
  EXISTS (
    SELECT 1 FROM room_members 
    WHERE room_members.room_id = rooms.id 
    AND room_members.user_id = auth.uid()
  )
);

CREATE POLICY "Authenticated users can create private rooms" 
ON public.rooms 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL AND 
  type = 'private' AND 
  created_by = auth.uid()
);

-- Update room_members to work with any room
DROP POLICY IF EXISTS "Users can join public rooms" ON public.room_members;

CREATE POLICY "Users can join rooms" 
ON public.room_members 
FOR INSERT 
WITH CHECK (
  user_id = auth.uid() AND 
  (
    -- Can join public rooms
    EXISTS (SELECT 1 FROM rooms WHERE rooms.id = room_id AND rooms.type = 'public')
    OR
    -- Can join private rooms with valid code
    EXISTS (SELECT 1 FROM rooms WHERE rooms.id = room_id AND rooms.type = 'private')
  )
);

-- Create a function to join a private room by code
CREATE OR REPLACE FUNCTION public.join_private_room(p_room_code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id TEXT;
  v_user_id UUID;
  v_result json;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Find the room by code
  SELECT id INTO v_room_id 
  FROM rooms 
  WHERE room_code = p_room_code AND type = 'private';

  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid room code');
  END IF;

  -- Check if already a member
  IF EXISTS (
    SELECT 1 FROM room_members 
    WHERE room_id = v_room_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', true, 'room_id', v_room_id, 'message', 'Already a member');
  END IF;

  -- Add to room members
  INSERT INTO room_members (room_id, user_id)
  VALUES (v_room_id, v_user_id);

  RETURN json_build_object('success', true, 'room_id', v_room_id);
END;
$$;

-- Create a function to create a private room
CREATE OR REPLACE FUNCTION public.create_private_room(p_room_name TEXT, p_room_code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Generate a unique room ID
  v_room_id := 'private_' || gen_random_uuid()::text;

  -- Create the room
  INSERT INTO rooms (id, name, type, created_by, room_code)
  VALUES (v_room_id, p_room_name, 'private', v_user_id, p_room_code);

  -- Add creator as member
  INSERT INTO room_members (room_id, user_id)
  VALUES (v_room_id, v_user_id);

  RETURN json_build_object('success', true, 'room_id', v_room_id, 'room_code', p_room_code);
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Room code already exists');
END;
$$;