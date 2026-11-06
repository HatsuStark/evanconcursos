-- Preços dos modelos da Anthropic (USD por milhão de tokens), para o custo em ai_usage e o teto diário por usuário.
-- Faixa de pedidos de até 100 mil tokens; as chamadas do app ficam abaixo disso (acima, 0,50 / 2,50 no Haiku).
insert into public.ai_model_prices (model, effective_from, input_per_mtok_usd, output_per_mtok_usd) values
  ('claude-haiku-5-5', '2026-01-01', 0.10, 0.50),
  ('claude-sonnet-5-5', '2026-01-01', 2.00, 10.00)
on conflict do nothing;
