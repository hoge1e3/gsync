<?php

define('REPO_DIR', __DIR__ . '/storage');

function createRepo(): string {
    do {
        $repo_id = bin2hex(random_bytes(8));
        $repo_path = REPO_DIR . "/$repo_id";
    } while (file_exists($repo_path));

    mkdir("$repo_path/objects", 0777, true);
    mkdir("$repo_path/refs/heads", 0777, true);

    return $repo_id;
}

function uploadObjects(array $data): string {
    $repo_id = $data['repo_id'];
    $objects = $data['objects'];

    $repo_path = REPO_DIR . "/$repo_id/objects";
    if (!is_dir($repo_path)) {
        http_response_code(404);
        exit(json_encode(['error' => 'Repo not found']));
    }

    $now = time();

    foreach ($objects as $obj) {
        $hash = $obj['hash'];
        $content = $obj['content'];

        $dir = substr($hash, 0, 2);
        $file = substr($hash, 2);

        $object_dir = "$repo_path/$dir";
        $object_path = "$object_dir/$file";

        if (!is_dir($object_dir)) {
            mkdir($object_dir, 0777, true);
        }

        if (!file_exists($object_path)) {
            $binary = base64_decode($content);                  
            file_put_contents($object_path, $binary);
            touch($object_path, $now);
        }
    }

    return $now;
}
function downloadObjects(array $data): array {
    $repo_id = $data['repo_id'];
    $since = $data['since'];
    $repo_path = REPO_DIR . "/$repo_id/objects";

    if (!is_dir($repo_path)) {
        http_response_code(404);
        exit(json_encode(['error' => 'Repo $repo_id not found']));
    }

    $result = [];

    $dirs = scandir($repo_path);
    $newest=time();
    foreach ($dirs as $dir) {
        if ($dir===".."||$dir===".") continue;
        if (strlen($dir) !== 2 || !is_dir("$repo_path/$dir")) continue;

        foreach (scandir("$repo_path/$dir") as $file) {
            if ($file === '.' || $file === '..') continue;

            $full = "$repo_path/$dir/$file";
            $mt=filemtime($full);
            if ($mt >= $since) {
                //if ($mt >=$newest) $newest=$mt;
                $hash = $dir . $file;
                $binary = file_get_contents($full);
                $base64 = base64_encode($binary);
                $result[] = [
                    'hash' => $hash,
                    'content' => $base64,
                ];
            }
        }
    }

    return ['objects' => $result, 'newest'=>$newest];
}


function getHead(array $data): ?string {
    $repo_id = $data['repo_id'];
    $branch = $data['branch'];
    $allow_nonexistent= $data["allow_nonexistent"] ?? false;
    $head_path = REPO_DIR . "/$repo_id/refs/heads/$branch";
    if (!file_exists($head_path)) {
        if ($allow_nonexistent) return null;
        http_response_code(404);
        exit(json_encode(['error' => "$repo_id:$branch not found"]));
    }
    return trim(file_get_contents($head_path));
}

function setHead(array $data): string {
    $repo_id = $data['repo_id'];
    $branch = $data['branch'];
    $current = $data['current'] ?? null;
    $next = $data['next'];
    $heads_dir=REPO_DIR . "/$repo_id/refs/heads";
    if (!is_dir($heads_dir)) {
        mkdir($heads_dir, 0777, true);
    }
    $head_path = "$heads_dir/$branch";
    if (file_exists($head_path)) {
        $real_current=file_get_contents($head_path);
        if ($current==null) {
            e505("$current is null");
        }
        if ($real_current!==$current) {
            return $real_current;//"prev hash does not match: set $branch to $next";
        }
    }
    // 履歴を残す（タイムスタンプ付きバックアップ）
    /*if (file_exists($head_path)) {
        $old = file_get_contents($head_path);
        file_put_contents("$head_path." . time(), $old);
    }*/

    if (!file_put_contents($head_path, $next)) {
        e505("Cannot write to $head_path=$next");
    };
    return "ok";
}
function parseJson($str) {
    $r=json_decode($str);
    if ($r===null) {
        throw new Exception("Cannot parse json: $str");
    }
    return $r;
}