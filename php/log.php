<?php
$LOG_FILE = __DIR__ . '/storage/log.jsonl';
$id=rand(100000, 999999);
function logMessage($body) {
    global $LOG_FILE, $id;
    $timestamp = date('Y-m-d H:i:s');
    $logEntry = json_encode([
        'access' => $id, 
        'remote_addr' => $_SERVER['REMOTE_ADDR'], 
        'query_string'=> $_SERVER['QUERY_STRING'], 
        'user_agent' => $_SERVER['HTTP_USER_AGENT'],
        'timestamp' => $timestamp, 
        'body' => $body
    ]) . PHP_EOL;
    file_put_contents($LOG_FILE, $logEntry, FILE_APPEND);
}
