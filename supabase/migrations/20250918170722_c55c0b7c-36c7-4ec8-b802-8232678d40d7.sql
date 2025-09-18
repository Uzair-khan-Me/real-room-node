-- Enable anonymous access for private rooms
-- Create anonymous_rooms table for rooms that don't require authentication
CREATE TABLE public.anonymous_rooms (
  id TEXT PRIMARY KEY DEFAULT 'anon_' || gen_random_uuid()::text,
  room_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Enable RLS on anonymous_rooms
ALTER TABLE public.anonymous_rooms ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view anonymous rooms by code
CREATE POLICY "Anyone can view anonymous rooms" 
ON public.anonymous_rooms 
FOR SELECT 
USING (true);

-- Allow anyone to create anonymous rooms
CREATE POLICY "Anyone can create anonymous rooms" 
ON public.anonymous_rooms 
FOR INSERT 
WITH CHECK (true);

-- Create anonymous_messages table
CREATE TABLE public.anonymous_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES anonymous_rooms(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on anonymous_messages
ALTER TABLE public.anonymous_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view and send messages in anonymous rooms
CREATE POLICY "Anyone can view anonymous messages" 
ON public.anonymous_messages 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can send anonymous messages" 
ON public.anonymous_messages 
FOR INSERT 
WITH CHECK (true);

-- Create function to join or create anonymous room
CREATE OR REPLACE FUNCTION public.join_or_create_anonymous_room(
  p_room_code TEXT,
  p_room_name TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id TEXT;
  v_room_name TEXT;
BEGIN
  -- Check if room exists
  SELECT id, name INTO v_room_id, v_room_name
  FROM anonymous_rooms
  WHERE room_code = p_room_code
  AND expires_at > now();

  IF v_room_id IS NOT NULL THEN
    -- Room exists, return it
    RETURN json_build_object(
      'success', true,
      'room_id', v_room_id,
      'room_name', v_room_name,
      'action', 'joined'
    );
  ELSE
    -- Create new room
    IF p_room_name IS NULL THEN
      p_room_name := 'Room ' || p_room_code;
    END IF;
    
    INSERT INTO anonymous_rooms (room_code, name)
    VALUES (p_room_code, p_room_name)
    RETURNING id INTO v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'room_id', v_room_id,
      'room_name', p_room_name,
      'action', 'created'
    );
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    -- Race condition, room was just created by someone else
    SELECT id, name INTO v_room_id, v_room_name
    FROM anonymous_rooms
    WHERE room_code = p_room_code;
    
    RETURN json_build_object(
      'success', true,
      'room_id', v_room_id,
      'room_name', v_room_name,
      'action', 'joined'
    );
END;
$$;

-- Create function to clean up expired anonymous rooms
CREATE OR REPLACE FUNCTION public.cleanup_expired_anonymous_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM anonymous_rooms WHERE expires_at < now();
END;
$$;