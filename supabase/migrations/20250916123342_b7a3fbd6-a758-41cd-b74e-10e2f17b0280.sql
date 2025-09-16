-- Drop existing public RLS policies
DROP POLICY IF EXISTS "Messages are viewable by everyone" ON public.messages;
DROP POLICY IF EXISTS "Presence is viewable by everyone" ON public.user_presence;

-- Create new RLS policies that require authentication
CREATE POLICY "Messages are viewable by authenticated users" 
ON public.messages 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Presence is viewable by authenticated users" 
ON public.user_presence 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Update INSERT policies to require authentication
DROP POLICY IF EXISTS "Anyone can send messages" ON public.messages;
CREATE POLICY "Authenticated users can send messages" 
ON public.messages 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Update user_presence ALL policy to require authentication
DROP POLICY IF EXISTS "Anyone can update their presence" ON public.user_presence;
CREATE POLICY "Authenticated users can manage their presence" 
ON public.user_presence 
FOR ALL 
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');