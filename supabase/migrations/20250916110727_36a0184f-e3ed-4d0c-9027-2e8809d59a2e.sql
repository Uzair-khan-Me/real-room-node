-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL DEFAULT 'general',
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create policy for anyone to read messages (public chat)
CREATE POLICY "Messages are viewable by everyone" 
ON public.messages 
FOR SELECT 
USING (true);

-- Create policy for anyone to insert messages (public chat)
CREATE POLICY "Anyone can send messages" 
ON public.messages 
FOR INSERT 
WITH CHECK (true);

-- Create index for better performance
CREATE INDEX idx_messages_room_created ON public.messages(room_id, created_at DESC);

-- Create presence table for typing indicators
CREATE TABLE public.user_presence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  username TEXT NOT NULL,
  is_typing BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(room_id, username)
);

-- Enable RLS
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Policies for presence
CREATE POLICY "Presence is viewable by everyone" 
ON public.user_presence 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can update their presence" 
ON public.user_presence 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Function to clean up old presence records
CREATE OR REPLACE FUNCTION public.cleanup_old_presence()
RETURNS void AS $$
BEGIN
  DELETE FROM public.user_presence 
  WHERE last_seen < now() - interval '5 minutes';
END;
$$ LANGUAGE plpgsql;