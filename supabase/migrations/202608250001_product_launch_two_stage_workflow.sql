-- Active product-launch workflow is now only Detail Page + Shopling Upload.
-- Legacy stage records remain in the state for audit/history, but are permanently excluded
-- from completion gating so existing integrations can still read their historical payloads.

update public.product_launch_tracker_states s
set state_payload = jsonb_set(
      s.state_payload,
      '{items}',
      coalesce((
        select jsonb_agg(
          item.value || jsonb_build_object(
            'stages',
            coalesce(item.value->'stages', '{}'::jsonb) || jsonb_build_object(
              'priceKeyword', coalesce(item.value->'stages'->'priceKeyword', '{}'::jsonb) || jsonb_build_object('status', '제외'),
              'marketRegistration', coalesce(item.value->'stages'->'marketRegistration', '{}'::jsonb) || jsonb_build_object('status', '제외'),
              'orderMapping', coalesce(item.value->'stages'->'orderMapping', '{}'::jsonb) || jsonb_build_object('status', '제외'),
              'inventoryReflection', coalesce(item.value->'stages'->'inventoryReflection', '{}'::jsonb) || jsonb_build_object('status', '제외')
            )
          )
          order by item.ordinality
        )
        from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb))
          with ordinality item(value, ordinality)
      ), '[]'::jsonb),
      true
    ),
    updated_at = now();

update public.product_launch_items
set price_keyword_status = '제외',
    market_registration_status = '제외',
    order_mapping_status = '제외',
    inventory_reflection_status = '제외',
    updated_at = now()
where price_keyword_status <> '제외'
   or market_registration_status <> '제외'
   or order_mapping_status <> '제외'
   or inventory_reflection_status <> '제외';
