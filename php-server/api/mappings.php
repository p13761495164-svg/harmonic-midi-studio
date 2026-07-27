<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $pdo->query(
        'SELECT program, custom_timbre_id, updated_at
         FROM harmonic_program_mappings
         WHERE custom_timbre_id IS NOT NULL
         ORDER BY program'
    )->fetchAll();
    $mappings = [];
    foreach ($rows as $row) {
        $mappings[] = [
            'program' => (int)$row['program'],
            'customTimbreId' => (int)$row['custom_timbre_id'],
            'updatedAt' => $row['updated_at'],
        ];
    }
    respond(['mappings' => $mappings]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') {
    respond(['error' => '不支持的请求方法'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
$program = filter_var($input['program'] ?? null, FILTER_VALIDATE_INT);
if ($program === false || $program < 0 || $program > 127) {
    respond(['error' => 'Program 必须在 0 到 127 之间'], 422);
}

$customId = $input['customTimbreId'] ?? null;
if ($customId === null || $customId === '') {
    $statement = $pdo->prepare('DELETE FROM harmonic_program_mappings WHERE program = ?');
    $statement->execute([$program]);
    respond(['mapping' => ['program' => $program, 'customTimbreId' => null]]);
}

$customId = filter_var($customId, FILTER_VALIDATE_INT);
if ($customId === false || $customId < 1) {
    respond(['error' => 'Custom 音色 ID 无效'], 422);
}
$check = $pdo->prepare('SELECT 1 FROM harmonic_custom_timbres WHERE id = ?');
$check->execute([$customId]);
if (!$check->fetchColumn()) {
    respond(['error' => '找不到 Custom 音色'], 404);
}

$statement = $pdo->prepare(
    'INSERT INTO harmonic_program_mappings (program, custom_timbre_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE custom_timbre_id = VALUES(custom_timbre_id)'
);
$statement->execute([$program, $customId]);
respond(['mapping' => ['program' => $program, 'customTimbreId' => $customId]]);
