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
    $path = dirname(__DIR__, 2) . '/config.php';
    if (!is_file($path)) {
        respond(['error' => '服务器尚未配置 config.php'], 503);
    }
    $config = require $path;
    if (!is_array($config)) {
        respond(['error' => 'config.php 格式错误'], 500);
    }
    return $config;
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
    try {
        seed_instruments($pdo);
    } catch (Throwable $error) {
        respond(['error' => '数据库表尚未安装，请先导入 database.sql'], 503);
    }
    return $pdo;
}

function defaults_for_program(int $program): array
{
    $family = intdiv($program, 8);
    $defaults = [
        'attack' => 0.018, 'decay' => 0.20, 'sustain' => 0.72, 'release' => 0.48,
        'brightness' => 2500, 'resonance' => 0.8, 'harmonics' => 0.28, 'volume' => 0.075, 'reverb' => 0.10,
    ];
    if ($program === 0) {
        return ['attack' => 0.0015, 'decay' => 0.18, 'sustain' => 0, 'release' => 1.55, 'brightness' => 7600, 'resonance' => 0.8, 'harmonics' => 0.32, 'volume' => 0.105, 'reverb' => 0.20];
    }
    if ($program === 46) {
        return ['attack' => 0.004, 'decay' => 0.18, 'sustain' => 0, 'release' => 3.0, 'brightness' => 5200, 'resonance' => 1.8, 'harmonics' => 0.30, 'volume' => 0.13, 'reverb' => 0.16];
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

function seed_instruments(PDO $pdo): void
{
    $count = (int)$pdo->query('SELECT COUNT(*) FROM instrument_presets')->fetchColumn();
    if ($count >= 128) {
        return;
    }
    $statement = $pdo->prepare(
        'INSERT IGNORE INTO instrument_presets
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

function require_admin(): void
{
    $config = config();
    $provided = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
    $expected = (string)($config['admin_key'] ?? '');
    if ($expected === '' || !hash_equals($expected, $provided)) {
        respond(['error' => '管理密钥不正确'], 401);
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
