<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $favoriteOnly = ($_GET['favorites'] ?? '') === '1';
    $sql = 'SELECT * FROM harmonic_instrument_presets';
    if ($favoriteOnly) {
        $sql .= ' WHERE is_favorite = 1';
    }
    $sql .= ' ORDER BY program';
    $rows = $pdo->query($sql)->fetchAll();
    respond(['instruments' => array_map('preset_payload', $rows)]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') {
    respond(['error' => '不支持的请求方法'], 405);
}

require_admin();
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    respond(['error' => '请求内容不是有效 JSON'], 400);
}

$program = filter_var($input['program'] ?? null, FILTER_VALIDATE_INT);
if ($program === false || $program < 0 || $program > 127) {
    respond(['error' => 'Program 必须在 0 到 127 之间'], 422);
}

$ranges = [
    'attack' => [0.001, 0.4],
    'decay' => [0.03, 1.2],
    'sustain' => [0, 1],
    'release' => [0.08, 4],
    'filter' => [300, 10000],
    'resonance' => [0.1, 12],
    'harmonics' => [0, 1.5],
    'level' => [0.02, 0.2],
    'wet' => [0, 0.5],
];

$values = [];
foreach ($ranges as $key => [$min, $max]) {
    if (!isset($input[$key]) || !is_numeric($input[$key])) {
        respond(['error' => "缺少参数 {$key}"], 422);
    }
    $values[$key] = min($max, max($min, (float)$input[$key]));
}
$favorite = !empty($input['favorite']) ? 1 : 0;

$statement = $pdo->prepare(
    'UPDATE harmonic_instrument_presets SET
    attack = ?, decay_seconds = ?, sustain = ?, release_seconds = ?, brightness = ?,
    resonance = ?, harmonics = ?, volume = ?, reverb = ?, is_favorite = ?
    WHERE program = ?'
);
$statement->execute([
    $values['attack'], $values['decay'], $values['sustain'], $values['release'], (int)$values['filter'],
    $values['resonance'], $values['harmonics'], $values['level'], $values['wet'], $favorite, $program,
]);

$statement = $pdo->prepare('SELECT * FROM harmonic_instrument_presets WHERE program = ?');
$statement->execute([$program]);
respond(['instrument' => preset_payload($statement->fetch())]);
