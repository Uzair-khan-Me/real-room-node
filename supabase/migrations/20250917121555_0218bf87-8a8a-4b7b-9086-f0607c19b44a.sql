-- Fix function search path to prevent SQL injection vulnerabilities
CREATE OR REPLACE FUNCTION public.cleanup_old_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_presence 
  WHERE last_seen < now() - interval '5 minutes';
END;
$$;