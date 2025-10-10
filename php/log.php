<?php
require_once("config.php");
$LOG_FILE = REPO_DIR."/log.jsonl";
$id=rand(100000, 999999);
function logFile($repo) {
    return ADMIN_DIR."/$repo/log.jsonl";
}
function api_keys($repo) {
    $res=[];
    $lf=logFile($repo);
    if (!file_exists($lf))return $res;
    foreach(file($lf) as $line){ 
        try {
            $o=json_decode($line);
            $api_key=$o->body->input->api_key;
            $timestamp=$o->timestamp;
            $res[$api_key]=$timestamp;
        } catch(Throwable $e) {
            $res["error"]=$e->getMessage();
        }
    }
    return $res;
}
function tz(){
    $tz = new DateTimeZone(date_default_timezone_get());
    // 現在日時をそのタイムゾーンで生成
    $dt = new DateTime('now', $tz);
    // タイムゾーン付きフォーマット（例：2025-10-08T15:20:00+09:00）
    return $dt->format('c');  // ISO 8601形式
}
function logMessage($body) {
    global $LOG_FILE, $id;
    $timestamp = tz();//date('Y-m-d H:i:s');
    $logEntry = json_encode([
        'access' => $id, 
        'remote_addr' => $_SERVER['REMOTE_ADDR'], 
        'query_string'=> $_SERVER['QUERY_STRING'], 
        'user_agent' => $_SERVER['HTTP_USER_AGENT'],
        'timestamp' => $timestamp, 
        'body' => $body
    ]) . PHP_EOL;
    try {
        $repo=$body["input"]["repo_id"];
        if ($repo){
            $logFileByRepo=logFile($repo);
            if (file_exists(dirname($logFileByRepo))) {
                file_put_contents($logFileByRepo, $logEntry, FILE_APPEND);
            }
        }
    } catch(Throwable $e) {
        $errlog=json_encode([
            "message" => $e->getMessage()
        ]).PHP_EOL;
        file_put_contents($LOG_FILE, $errlog, FILE_APPEND);
    }
    file_put_contents($LOG_FILE, $logEntry, FILE_APPEND);
}
