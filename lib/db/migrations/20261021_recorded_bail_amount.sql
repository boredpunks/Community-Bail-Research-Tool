-- Development only. Check database separation before applying manually.
-- No startup/build hook and no production-targeting runner.
ALTER TYPE public.bail_financial_basis ADD VALUE IF NOT EXISTS 'RECORDED_BAIL_AMOUNT';
