INSERT INTO currencies (code, name, symbol, decimal_digits) VALUES
  ('IDR', 'Indonesian Rupiah', 'Rp', 0);

INSERT INTO exchange_rates (id, base_code, quote_code, rate_date, rate, source) VALUES
  (gen_random_uuid(), 'USD', 'IDR', CURRENT_DATE, 15800, 'seed');
