-- Create profiles table for user information
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
CREATE POLICY "Profiles are viewable by authenticated users" 
ON public.profiles 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Update messages table to link to user_id
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Update room_members to use user_id instead of username
ALTER TABLE public.room_members 
DROP COLUMN IF EXISTS username CASCADE;

ALTER TABLE public.room_members 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) NOT NULL;

-- Recreate unique constraint
ALTER TABLE public.room_members 
DROP CONSTRAINT IF EXISTS room_members_room_id_username_key;

ALTER TABLE public.room_members 
ADD CONSTRAINT room_members_room_id_user_id_key UNIQUE(room_id, user_id);

-- Update user_presence to use user_id
ALTER TABLE public.user_presence 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Drop and recreate policies for messages with user-based access
DROP POLICY IF EXISTS "Users can view messages in their rooms" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages to their rooms" ON public.messages;

CREATE POLICY "Users can view messages in their rooms" 
ON public.messages 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE room_members.room_id = messages.room_id 
    AND room_members.user_id = auth.uid()
  )
);

CREATE POLICY "Users can send messages to their rooms" 
ON public.messages 
FOR INSERT 
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.room_members 
    WHERE room_members.room_id = messages.room_id 
    AND room_members.user_id = auth.uid()
  )
);

-- Update room_members policies
DROP POLICY IF EXISTS "Users can view room members" ON public.room_members;
DROP POLICY IF EXISTS "Users can join public rooms" ON public.room_members;
DROP POLICY IF EXISTS "Users can leave rooms" ON public.room_members;

CREATE POLICY "Users can view room members for their rooms" 
ON public.room_members 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.room_members rm 
    WHERE rm.room_id = room_members.room_id 
    AND rm.user_id = auth.uid()
  )
);

CREATE POLICY "Users can join public rooms" 
ON public.room_members 
FOR INSERT 
WITH CHECK (
  user_id = auth.uid()
  AND room_id IN ('general', 'random', 'tech')
);

CREATE POLICY "Users can leave their own rooms" 
ON public.room_members 
FOR DELETE 
USING (user_id = auth.uid());

-- Update user_presence policies
DROP POLICY IF EXISTS "Users can view presence in their rooms" ON public.user_presence;
DROP POLICY IF EXISTS "Users can manage their own presence" ON public.user_presence;

CREATE POLICY "Users can view presence in their rooms" 
ON public.user_presence 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.room_members rm1
    JOIN public.room_members rm2 ON rm1.room_id = rm2.room_id
    WHERE rm1.user_id = auth.uid()
    AND rm2.user_id = user_presence.user_id
  )
);

CREATE POLICY "Users can manage their own presence" 
ON public.user_presence 
FOR ALL 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Add updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();