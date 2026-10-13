# Security

The app currently has a public issue tracker but no confidential vulnerability-reporting channel; do not post secrets or personal data there. Keep `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TAKEDOWN_SECRET` in private server-side environment variables; never use a `NEXT_PUBLIC_` prefix or commit their values. The comparison endpoint is same-origin, size-limited, and protected by a shared server-side quota. It fails closed if the limiter is unavailable.

The operator takedown route requires its separate bearer secret. Historical Supabase records remain governed by existing row-level security and the operator takedown process. The active product does not ingest or expose those records. Groq browser-search pages are untrusted: the model is instructed not to follow their instructions, and output links and citations are structurally checked, but Atlas does not independently verify source content. Do not use its output as investment advice.
