-- 016_client_documents.sql
-- Adds profile photo, ID document, and phone-verification tracking columns.
--
-- These support client-portal features:
--   - profile_photo_url         : path/URL to uploaded avatar
--   - id_document_url           : path/URL to uploaded ID (JPG/PNG/PDF)
--   - id_document_uploaded_at   : when the ID was last uploaded
--   - phone_verified_at         : reserved for a future SMS verification flow
--
-- Files themselves are stored outside the web root at data/uploads/ and
-- served only via authenticated endpoints.

ALTER TABLE clients
  ADD COLUMN profile_photo_url        VARCHAR(255) NULL,
  ADD COLUMN id_document_url          VARCHAR(255) NULL,
  ADD COLUMN id_document_uploaded_at  TIMESTAMP NULL,
  ADD COLUMN phone_verified_at        TIMESTAMP NULL;
