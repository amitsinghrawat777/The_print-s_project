-- Local development data. Applied by `supabase db reset`.
-- Demo shop owner login: owner@demo.test / demo-password
-- Customer page: http://localhost:3030/s/demo-xerox

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'owner@demo.test',
  extensions.crypt('demo-password', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner@demo.test","email_verified":true}',
  'email', now(), now(), now()
);

insert into public.shops (id, owner_id, name, slug, address, duplex_available, paper_sizes)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Sharma Xerox & Print', 'demo-xerox', 'Near College Gate, Dehradun', true, '{A4,A3}'
);

-- ₹2 B&W page, ₹10 colour page, ₹3 B&W sheet (both sides), ₹18 colour sheet; A3 is double
insert into public.shop_rates (shop_id, paper_size, color_mode, sides, price_paise) values
  ('22222222-2222-4222-8222-222222222222', 'A4', 'bw', 'single', 200),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'color', 'single', 1000),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'bw', 'double', 300),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'color', 'double', 1800),
  ('22222222-2222-4222-8222-222222222222', 'A3', 'bw', 'single', 400),
  ('22222222-2222-4222-8222-222222222222', 'A3', 'color', 'single', 2000);
