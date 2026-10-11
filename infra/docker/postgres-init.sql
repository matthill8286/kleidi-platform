-- Dev only. The app connects as a non-owner role so row-level security is enforced.
CREATE ROLE kleidi_app LOGIN PASSWORD 'kleidi_app';
GRANT CONNECT ON DATABASE kleidi TO kleidi_app;
