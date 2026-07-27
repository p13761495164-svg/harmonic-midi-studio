<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/bootstrap.php';

$pdo = db();
$statement = $pdo->prepare(
    'INSERT INTO applist_apps
        (app_key, display_name, description, icon_text, color_key, target_url, is_visible, sort_order, updated_at_ms)
     VALUES
        (:app_key, :display_name, :description, :icon_text, :color_key, :target_url, 1, :sort_order, :updated_at_ms)
     ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        description = VALUES(description),
        icon_text = VALUES(icon_text),
        color_key = VALUES(color_key),
        target_url = VALUES(target_url),
        is_visible = 1,
        updated_at_ms = VALUES(updated_at_ms)'
);
$statement->execute([
    'app_key' => 'harmonic-midi',
    'display_name' => 'Harmonic MIDI',
    'description' => 'MIDI 分轨播放与音色管理',
    'icon_text' => '♫',
    'color_key' => 'violet',
    'target_url' => 'apps/harmonic-midi/',
    'sort_order' => 20,
    'updated_at_ms' => (int)round(microtime(true) * 1000),
]);

echo "Harmonic MIDI installed: 128 instruments and app-list entry are ready.\n";
