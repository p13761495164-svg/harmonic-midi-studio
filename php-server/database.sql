CREATE TABLE IF NOT EXISTS harmonic_instrument_presets (
    program TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    name VARCHAR(96) NOT NULL,
    family VARCHAR(48) NOT NULL,
    attack DECIMAL(7,4) NOT NULL,
    decay_seconds DECIMAL(7,4) NOT NULL,
    sustain DECIMAL(6,4) NOT NULL,
    release_seconds DECIMAL(7,4) NOT NULL,
    brightness SMALLINT UNSIGNED NOT NULL,
    resonance DECIMAL(6,3) NOT NULL,
    harmonics DECIMAL(6,3) NOT NULL,
    volume DECIMAL(6,4) NOT NULL,
    reverb DECIMAL(6,4) NOT NULL,
    is_favorite TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_harmonic_instrument_favorite (is_favorite),
    INDEX idx_harmonic_instrument_family (family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS harmonic_custom_timbres (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    custom_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    description VARCHAR(240) NOT NULL DEFAULT '',
    base_program TINYINT UNSIGNED NOT NULL DEFAULT 0,
    engine_key VARCHAR(24) CHARACTER SET ascii NOT NULL DEFAULT 'standard',
    transpose_kalimba TINYINT(1) NOT NULL DEFAULT 0,
    attack DECIMAL(7,4) NOT NULL,
    decay_seconds DECIMAL(7,4) NOT NULL,
    sustain DECIMAL(6,4) NOT NULL,
    release_seconds DECIMAL(7,4) NOT NULL,
    brightness SMALLINT UNSIGNED NOT NULL,
    resonance DECIMAL(6,3) NOT NULL,
    harmonics DECIMAL(6,3) NOT NULL,
    volume DECIMAL(6,4) NOT NULL,
    reverb DECIMAL(6,4) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_harmonic_custom_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS harmonic_program_mappings (
    program TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    custom_timbre_id BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_harmonic_mapping_custom
        FOREIGN KEY (custom_timbre_id) REFERENCES harmonic_custom_timbres(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS harmonic_schema_migrations (
    migration_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
