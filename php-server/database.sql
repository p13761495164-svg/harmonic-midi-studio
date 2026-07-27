CREATE TABLE IF NOT EXISTS instrument_presets (
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
    INDEX idx_instrument_favorite (is_favorite),
    INDEX idx_instrument_family (family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
