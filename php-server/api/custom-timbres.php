<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $pdo->query('SELECT * FROM harmonic_custom_timbres ORDER BY name, id')->fetchAll();
    respond(['customTimbres' => array_map('custom_timbre_payload', $rows)]);
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        respond(['error' => 'Custom 音色 ID 无效'], 422);
    }
    $statement = $pdo->prepare('DELETE FROM harmonic_custom_timbres WHERE id = ?');
    $statement->execute([$id]);
    respond(['deleted' => $statement->rowCount() > 0]);
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT'], true)) {
    respond(['error' => '不支持的请求方法'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    respond(['error' => '请求内容不是有效 JSON'], 400);
}

$name = trim((string)($input['name'] ?? ''));
if ($name === '' || mb_strlen($name) > 96) {
    respond(['error' => '名称不能为空且不能超过 96 个字符'], 422);
}
$description = mb_substr(trim((string)($input['description'] ?? '')), 0, 240);
$baseProgram = filter_var($input['baseProgram'] ?? null, FILTER_VALIDATE_INT);
if ($baseProgram === false || $baseProgram < 0 || $baseProgram > 127) {
    respond(['error' => '基础 GM 音色必须在 1 到 128 之间'], 422);
}
$engine = in_array(($input['engine'] ?? ''), ['standard', 'kalimba'], true)
    ? $input['engine']
    : 'standard';

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
$transpose = !empty($input['transposeKalimba']) ? 1 : 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $customKey = 'custom-' . bin2hex(random_bytes(8));
    $statement = $pdo->prepare(
        'INSERT INTO harmonic_custom_timbres
        (custom_key, name, description, base_program, engine_key, transpose_kalimba,
         attack, decay_seconds, sustain, release_seconds, brightness, resonance, harmonics, volume, reverb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        $customKey, $name, $description, $baseProgram, $engine, $transpose,
        $values['attack'], $values['decay'], $values['sustain'], $values['release'],
        (int)$values['filter'], $values['resonance'], $values['harmonics'], $values['level'], $values['wet'],
    ]);
    $id = (int)$pdo->lastInsertId();
} else {
    $id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        respond(['error' => 'Custom 音色 ID 无效'], 422);
    }
    $statement = $pdo->prepare(
        'UPDATE harmonic_custom_timbres SET
         name = ?, description = ?, base_program = ?, engine_key = ?, transpose_kalimba = ?,
         attack = ?, decay_seconds = ?, sustain = ?, release_seconds = ?, brightness = ?,
         resonance = ?, harmonics = ?, volume = ?, reverb = ?
         WHERE id = ?'
    );
    $statement->execute([
        $name, $description, $baseProgram, $engine, $transpose,
        $values['attack'], $values['decay'], $values['sustain'], $values['release'],
        (int)$values['filter'], $values['resonance'], $values['harmonics'], $values['level'], $values['wet'], $id,
    ]);
}

$statement = $pdo->prepare('SELECT * FROM harmonic_custom_timbres WHERE id = ?');
$statement->execute([$id]);
$row = $statement->fetch();
if (!$row) {
    respond(['error' => '找不到 Custom 音色'], 404);
}
respond(['customTimbre' => custom_timbre_payload($row)]);
