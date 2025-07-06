<?php
require_once "ErrorHandler.php";
require_once 'utils.php';
header("Content-Type: application/json");
$method = $_SERVER['REQUEST_METHOD'];
$path = $_GET['action'] ?? '';

switch ($path) {
    case 'create':
        echo json_encode(['repo_id' => createRepo()]);
        break;

    case 'upload':
        $input = parseJson(file_get_contents('php://input'), true);
        echo json_encode(['timestamp' => uploadObjects($input)]);
        break;

    case 'download':
        $input = parseJson(file_get_contents('php://input'), true);
        echo json_encode(downloadObjects($input));
        break;

    case 'get_head':
        $input = parseJson(file_get_contents('php://input'), true);
        echo json_encode(['hash' => getHead($input)]);
        break;

    case 'set_head':
        $input = parseJson(file_get_contents('php://input'), true);
        $status = setHead($input);
        if (!$status) e505("Status is null :".json_encode(($input)));
        echo json_encode(['status' => $status]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
}
