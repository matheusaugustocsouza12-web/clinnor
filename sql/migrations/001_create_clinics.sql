BEGIN;

-- 1. Criar a estrutura das clínicas
CREATE TABLE IF NOT EXISTS clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Criar a clínica inicial usando o nome já existente
INSERT INTO clinics (name, slug)
SELECT business_name, 'minha-clinica'
FROM clinic_settings
WHERE id = 1
ON CONFLICT (slug) DO NOTHING;

-- 3. Adicionar a identificação da clínica aos usuários
ALTER TABLE users
ADD COLUMN IF NOT EXISTS clinic_id UUID;

-- 4. Associar os usuários existentes à clínica inicial
UPDATE users
SET clinic_id = (
  SELECT id
  FROM clinics
  WHERE slug = 'minha-clinica'
)
WHERE clinic_id IS NULL;

-- 5. Impedir que existam usuários sem uma clínica
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clinics WHERE slug = 'minha-clinica'
  ) THEN
    RAISE EXCEPTION 'Clínica inicial não encontrada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users WHERE clinic_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Existem usuários sem clínica associada.';
  END IF;
END $$;

ALTER TABLE users
ALTER COLUMN clinic_id SET NOT NULL;

-- 6. Garantir que a clínica associada exista
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_clinic_id_fkey'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES clinics(id);
  END IF;
END $$;

COMMIT;
