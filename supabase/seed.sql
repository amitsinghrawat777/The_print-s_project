-- Local development seed: one demo owner and one demo shop.
--   Shop page:   http://localhost:3000/s/demo-xerox
--   Owner login: owner@demo.test / demo-password   (local only!)

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'owner@demo.test',
  extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"name":"Demo Owner"}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner@demo.test"}',
  'email', now(), now(), now()
);

insert into public.shops (id, owner_id, name, slug, duplex_available)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Demo Xerox & Print', 'demo-xerox', true
);

-- ₹2 / ₹3 B&W, ₹10 / ₹18 colour (single per page / double per sheet), A4 only.
insert into public.shop_rates (shop_id, paper_size, color_mode, sides, price_paise) values
  ('22222222-2222-4222-8222-222222222222', 'A4', 'bw',    'single',  200),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'bw',    'double',  300),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'color', 'single', 1000),
  ('22222222-2222-4222-8222-222222222222', 'A4', 'color', 'double', 1800);
