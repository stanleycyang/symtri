-- Both installed CLI versions were SIGKILLed during migration creation.
-- Reconcile terminal states without resetting attempts, failure history, or evidence.
update public.reading_notes set blocked=true
where status='failed' and not blocked and (
  attempts>=3 or failure_code in (
    'source-restricted','source-too-thin','source-too-large','source-http-404','source-http-410',
    'source-http-401','source-http-403','model-http-400','model-http-401','model-http-402','model-http-403'
  )
);
