-- SQL for setting up the feedback table in Supabase

-- Create the feedback table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create RPC function to create table if it doesn't exist
-- This allows the app to create the table on first use if needed
CREATE OR REPLACE FUNCTION create_feedback_table_if_not_exists()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if table exists
  IF NOT EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'feedback'
  ) THEN
    -- Create the table if it doesn't exist
    CREATE TABLE public.feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
      created_at TIMESTAMPTZ DEFAULT now()
    );
    
    -- Return true to indicate table was created
    RETURN TRUE;
  ELSE
    -- Return false to indicate table already existed
    RETURN FALSE;
  END IF;
END;
$$;

-- Add RLS (Row Level Security) policies
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to select feedback
CREATE POLICY "Allow anonymous select" ON public.feedback
  FOR SELECT USING (true);

-- Allow anyone to insert feedback (for submission)
CREATE POLICY "Allow anonymous insert" ON public.feedback
  FOR INSERT WITH CHECK (true);

-- Allow anonymous users to update and delete feedback (temporary - should restrict in production)
CREATE POLICY "Allow anonymous update" ON public.feedback
  FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous delete" ON public.feedback
  FOR DELETE USING (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO authenticated;
GRANT EXECUTE ON FUNCTION create_feedback_table_if_not_exists() TO anon;
GRANT EXECUTE ON FUNCTION create_feedback_table_if_not_exists() TO authenticated; 