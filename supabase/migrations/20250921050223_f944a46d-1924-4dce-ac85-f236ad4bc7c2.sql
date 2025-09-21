-- Create storage bucket for chat files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

-- Add file attachment columns to messages table
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS file_url TEXT,
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_type TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Add file attachment columns to anonymous_messages table
ALTER TABLE public.anonymous_messages 
ADD COLUMN IF NOT EXISTS file_url TEXT,
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_type TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Storage policies for authenticated users
CREATE POLICY "Users can upload files to their folders" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'chat-files' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view all chat files" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'chat-files');

CREATE POLICY "Users can delete their own files" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'chat-files' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Storage policies for anonymous users (using session-based approach)
CREATE POLICY "Anonymous users can upload files" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'chat-files' AND 
  (storage.foldername(name))[1] LIKE 'anon_%'
);

CREATE POLICY "Anonymous users can view chat files" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'chat-files' AND 
  (storage.foldername(name))[1] LIKE 'anon_%'
);