CREATE OR REPLACE FUNCTION public.syllogic_promote_first_user_to_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The transaction-scoped lock serializes concurrent first registrations.
  PERFORM pg_advisory_xact_lock(hashtext('syllogic:first-user-admin'));

  IF NOT EXISTS (SELECT 1 FROM public.users) THEN
    NEW.role := 'admin';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS syllogic_first_user_admin ON public.users;
--> statement-breakpoint
CREATE TRIGGER syllogic_first_user_admin
BEFORE INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.syllogic_promote_first_user_to_admin();
