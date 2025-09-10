<?php
require_once "ErrorHandler.php";
require_once 'utils.php';
require_once 'log.php';
require_once "config.php";
header("Content-Type: application/json");
if (defined("ALLOW_ORIGIN")){
    header("Access-Control-Allow-Origin: ".ALLOW_ORIGIN);
}
$method = $_SERVER['REQUEST_METHOD'];
$path = $_GET['action'] ?? '';

switch ($path) {
    case 'create':
        respond_with_log([], ['repo_id' => createRepo()]);
        break;

    case 'upload':
        $input = parseJson(file_get_contents('php://input'));
        respond_with_log($input, ['timestamp' => uploadObjects($input)]);
        break;

    case 'download':
        $input = parseJson(file_get_contents('php://input'));
        respond_with_log($input, downloadObjects($input));
        break;

    case 'get_head':
        $input = parseJson(file_get_contents('php://input'));
        respond_with_log($input, ['hash' => getHead($input)]);
        break;

    case 'set_head':
        $input = parseJson(file_get_contents('php://input'));
        $status = setHead($input);
        if (!$status) e505("Status is null :".json_encode(($input)));
        else respond_with_log($input, ['status' => $status]);
        break;

    default:
        http_response_code(400);
        respond_with_log([], ['error' => 'Invalid action']);
}
