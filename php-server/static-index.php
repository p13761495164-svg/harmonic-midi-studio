<?php

declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
readfile(__DIR__ . '/index.html');
