<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
$count = (int)$pdo->query('SELECT COUNT(*) FROM harmonic_instrument_presets')->fetchColumn();
respond(['ok' => true, 'database' => true, 'instruments' => $count]);
