<?php

declare(strict_types=1);

const GM_NAMES = [
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
    'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
    'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
    'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
    'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
    'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
    'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
    'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
    'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
    'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
    'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
    'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
    'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
    'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
    'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
    'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
    'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
    'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bag Pipe', 'Fiddle', 'Shanai',
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

const GM_FAMILIES = [
    'Piano', 'Chromatic Percussion', 'Organ', 'Guitar',
    'Bass', 'Strings', 'Ensemble', 'Brass',
    'Reed', 'Pipe', 'Synth Lead', 'Synth Pad',
    'Synth Effects', 'Ethnic', 'Percussive', 'Sound Effects',
];

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function config(): array
{
    $siteRoot = dirname(__DIR__, 3);
    $databasePath = $siteRoot . '/shared/database.php';
    if (!is_file($databasePath)) {
        respond(['error' => '找不到 personalApp/shared/database.php'], 503);
    }
    require $databasePath;

    return [
        'db_host' => $servername ?? '127.0.0.1',
        'db_port' => 3306,
        'db_name' => $dbname ?? '',
        'db_user' => $username ?? '',
        'db_password' => $password ?? '',
    ];
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $config = config();
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        (int)($config['db_port'] ?? 3306),
        $config['db_name']
    );
    try {
        $pdo = new PDO($dsn, $config['db_user'], $config['db_password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable $error) {
        respond(['error' => '无法连接 MySQL'], 503);
    }
    ensure_schema($pdo);
    $hadLegacyPresets = (int)$pdo->query('SELECT COUNT(*) FROM harmonic_instrument_presets')->fetchColumn() > 0;
    seed_instruments($pdo);
    seed_custom_timbres($pdo);
    migrate_legacy_custom_mappings($pdo, $hadLegacyPresets);
    return $pdo;
}

function ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS harmonic_instrument_presets (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS harmonic_custom_timbres (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            custom_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
            name VARCHAR(96) NOT NULL,
            description VARCHAR(240) NOT NULL DEFAULT \'\',
            base_program TINYINT UNSIGNED NOT NULL DEFAULT 0,
            engine_key VARCHAR(24) CHARACTER SET ascii NOT NULL DEFAULT \'standard\',
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS harmonic_program_mappings (
            program TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            custom_timbre_id BIGINT UNSIGNED NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_harmonic_mapping_custom
                FOREIGN KEY (custom_timbre_id) REFERENCES harmonic_custom_timbres(id)
                ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS harmonic_schema_migrations (
            migration_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function defaults_for_program(int $program): array
{
    $family = intdiv($program, 8);
    $defaults = [
        'attack' => 0.018, 'decay' => 0.20, 'sustain' => 0.72, 'release' => 0.48,
        'brightness' => 2500, 'resonance' => 0.8, 'harmonics' => 0.28, 'volume' => 0.075, 'reverb' => 0.10,
    ];
    if ($program === 46) {
        return ['attack' => 0.006, 'decay' => 0.18, 'sustain' => 0, 'release' => 2.40, 'brightness' => 3600, 'resonance' => 1.1, 'harmonics' => 0.22, 'volume' => 0.085, 'reverb' => 0.16];
    }
    if ($family === 0 || $family === 1 || $family === 3 || $family === 13) {
        return ['attack' => 0.004, 'decay' => 0.16, 'sustain' => 0, 'release' => 1.45, 'brightness' => 4200, 'resonance' => 0.8, 'harmonics' => 0.30, 'volume' => 0.09, 'reverb' => 0.12];
    }
    if ($family === 4) {
        return ['attack' => 0.008, 'decay' => 0.18, 'sustain' => 0.70, 'release' => 0.28, 'brightness' => 920, 'resonance' => 0.8, 'harmonics' => 0.24, 'volume' => 0.10, 'reverb' => 0.03];
    }
    if ($family === 5 || $family === 6 || $family === 11) {
        return ['attack' => 0.14, 'decay' => 0.38, 'sustain' => 0.82, 'release' => 1.45, 'brightness' => 1850, 'resonance' => 0.8, 'harmonics' => 0.34, 'volume' => 0.052, 'reverb' => 0.20];
    }
    if ($family === 7 || $family === 8 || $family === 9) {
        return ['attack' => 0.045, 'decay' => 0.22, 'sustain' => 0.76, 'release' => 0.55, 'brightness' => 2200, 'resonance' => 0.8, 'harmonics' => 0.32, 'volume' => 0.055, 'reverb' => 0.11];
    }
    if ($family === 10) {
        return ['attack' => 0.01, 'decay' => 0.15, 'sustain' => 0.70, 'release' => 0.35, 'brightness' => 2900, 'resonance' => 0.8, 'harmonics' => 0.38, 'volume' => 0.05, 'reverb' => 0.12];
    }
    return $defaults;
}

function seed_custom_timbres(PDO $pdo): void
{
    $check = $pdo->prepare('SELECT 1 FROM harmonic_schema_migrations WHERE migration_key = ?');
    $check->execute(['custom-mappings-v1']);
    if ($check->fetchColumn()) {
        return;
    }
    $statement = $pdo->prepare(
        'INSERT IGNORE INTO harmonic_custom_timbres
        (custom_key, name, description, base_program, engine_key, transpose_kalimba,
         attack, decay_seconds, sustain, release_seconds, brightness, resonance, harmonics, volume, reverb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        'kalimba-grand-piano', 'Kalimba · Grand Piano', 'Color Piano 风格的卡林巴映射',
        0, 'kalimba', 0, 0.0015, 0.18, 0, 1.55, 7600, 0.8, 0.32, 0.105, 0.20,
    ]);
    $statement->execute([
        'kalimba-orchestral-harp', 'Kalimba · Orchestral Harp', 'Transpose Piano 风格的高泛音卡林巴映射',
        46, 'kalimba', 1, 0.004, 0.18, 0, 3.0, 5200, 1.8, 0.30, 0.13, 0.16,
    ]);
}

function migrate_legacy_custom_mappings(PDO $pdo, bool $hadLegacyPresets): void
{
    $migrationKey = 'custom-mappings-v1';
    $check = $pdo->prepare('SELECT 1 FROM harmonic_schema_migrations WHERE migration_key = ?');
    $check->execute([$migrationKey]);
    if ($check->fetchColumn()) {
        return;
    }

    $pdo->beginTransaction();
    try {
        if ($hadLegacyPresets) {
            $pdo->exec(
                'UPDATE harmonic_custom_timbres custom
                 JOIN harmonic_instrument_presets preset ON preset.program = 0
                 SET custom.attack = preset.attack,
                     custom.decay_seconds = preset.decay_seconds,
                     custom.sustain = preset.sustain,
                     custom.release_seconds = preset.release_seconds,
                     custom.brightness = preset.brightness,
                     custom.resonance = preset.resonance,
                     custom.harmonics = preset.harmonics,
                     custom.volume = preset.volume,
                     custom.reverb = preset.reverb
                 WHERE custom.custom_key = \'kalimba-grand-piano\''
            );
            $pdo->exec(
                'UPDATE harmonic_custom_timbres custom
                 JOIN harmonic_instrument_presets preset ON preset.program = 46
                 SET custom.attack = preset.attack,
                     custom.decay_seconds = preset.decay_seconds,
                     custom.sustain = preset.sustain,
                     custom.release_seconds = preset.release_seconds,
                     custom.brightness = preset.brightness,
                     custom.resonance = preset.resonance,
                     custom.harmonics = preset.harmonics,
                     custom.volume = preset.volume,
                     custom.reverb = preset.reverb
                 WHERE custom.custom_key = \'kalimba-orchestral-harp\''
            );
        }
        $pdo->exec(
            'UPDATE harmonic_instrument_presets SET
                attack = 0.004, decay_seconds = 0.16, sustain = 0, release_seconds = 1.70,
                brightness = 4200, resonance = 0.8, harmonics = 0.28, volume = 0.09, reverb = 0.12
             WHERE program = 0'
        );
        $pdo->exec(
            'UPDATE harmonic_instrument_presets SET
                attack = 0.006, decay_seconds = 0.18, sustain = 0, release_seconds = 2.40,
                brightness = 3600, resonance = 1.1, harmonics = 0.22, volume = 0.085, reverb = 0.16
             WHERE program = 46'
        );
        $pdo->exec(
            'INSERT IGNORE INTO harmonic_program_mappings (program, custom_timbre_id)
             SELECT 0, id FROM harmonic_custom_timbres WHERE custom_key = \'kalimba-grand-piano\''
        );
        $pdo->exec(
            'INSERT IGNORE INTO harmonic_program_mappings (program, custom_timbre_id)
             SELECT 46, id FROM harmonic_custom_timbres WHERE custom_key = \'kalimba-orchestral-harp\''
        );
        $insert = $pdo->prepare('INSERT INTO harmonic_schema_migrations (migration_key) VALUES (?)');
        $insert->execute([$migrationKey]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function seed_instruments(PDO $pdo): void
{
    $count = (int)$pdo->query('SELECT COUNT(*) FROM harmonic_instrument_presets')->fetchColumn();
    if ($count >= 128) {
        return;
    }
    $statement = $pdo->prepare(
        'INSERT IGNORE INTO harmonic_instrument_presets
        (program, name, family, attack, decay_seconds, sustain, release_seconds, brightness, resonance, harmonics, volume, reverb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach (GM_NAMES as $program => $name) {
        $values = defaults_for_program($program);
        $statement->execute([
            $program, $name, GM_FAMILIES[intdiv($program, 8)],
            $values['attack'], $values['decay'], $values['sustain'], $values['release'],
            $values['brightness'], $values['resonance'], $values['harmonics'], $values['volume'], $values['reverb'],
        ]);
    }
}

function preset_payload(array $row): array
{
    return [
        'program' => (int)$row['program'],
        'name' => $row['name'],
        'family' => $row['family'],
        'attack' => (float)$row['attack'],
        'decay' => (float)$row['decay_seconds'],
        'sustain' => (float)$row['sustain'],
        'release' => (float)$row['release_seconds'],
        'filter' => (int)$row['brightness'],
        'resonance' => (float)$row['resonance'],
        'harmonics' => (float)$row['harmonics'],
        'level' => (float)$row['volume'],
        'wet' => (float)$row['reverb'],
        'favorite' => (bool)$row['is_favorite'],
        'updatedAt' => $row['updated_at'],
    ];
}

function custom_timbre_payload(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'key' => $row['custom_key'],
        'name' => $row['name'],
        'description' => $row['description'],
        'baseProgram' => (int)$row['base_program'],
        'engine' => $row['engine_key'],
        'transposeKalimba' => (bool)$row['transpose_kalimba'],
        'attack' => (float)$row['attack'],
        'decay' => (float)$row['decay_seconds'],
        'sustain' => (float)$row['sustain'],
        'release' => (float)$row['release_seconds'],
        'filter' => (int)$row['brightness'],
        'resonance' => (float)$row['resonance'],
        'harmonics' => (float)$row['harmonics'],
        'level' => (float)$row['volume'],
        'wet' => (float)$row['reverb'],
        'updatedAt' => $row['updated_at'],
    ];
}
