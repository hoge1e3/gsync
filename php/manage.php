<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . "/utils.php";
require_once __DIR__ . "/log.php";

function clone_cmd(){
    global $repoId;
    $uri=(empty($_SERVER['HTTPS']) ? 'http://' : 'https://') . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    $uri=preg_replace("/manage\\.php/","index.php", $uri);
    $uri=preg_replace("/\\?.*/","", $uri);
    return "gsync clone $uri $repoId";
}
$repoId = isset($_POST['repo']) ? $_POST["repo"] : 
         (isset($_GET['repo'])  ? $_GET["repo"]  : '' );
function login_form($repoId='') {
?>
    <h1>Login to Manage Repository</h1>
    <form method="post">
        <label>Repository ID : <input name="repo" value="<?= htmlspecialchars($repoId) ?>"></label><Br/>
        <label>Password: <input type="password" name="password"></label><br/>
        <button type="submit">Login</button>
    </form>
<?php
}
function new_password_form($repoId='') {
?>
    <h1>Set new password to Repository</h1>
    <form method="post">
        <label>Repository ID : <input name="repo" value="<?= htmlspecialchars($repoId) ?>"></label><Br/>
        <button type="submit">Next &gt;&gt;</button>
    </form>
    <?php
}

if ($repoId === '') {
    ?>
    Read <a target="eula" href="eula.html">Terms of use</a> first.
    <hr/>
    <?php 
    login_form($repoId); 
    new_password_form($repoId);
    exit;
}
if (!repoExists($repoId)) {
    die("No such repository: $repoId");    
}

$repoAdminDir = ADMIN_DIR . '/' . $repoId;
if (!is_dir($repoAdminDir)) {
    mkdir($repoAdminDir, 0777, true);
}

$passwordFile = $repoAdminDir . '/password.txt';
$apikeyFile   = $repoAdminDir . '/apikeys.json';

// Load API keys
$apikeys = file_exists($apikeyFile) ? json_decode(file_get_contents($apikeyFile), true) : [];
if (!is_array($apikeys)) $apikeys = [];

// Step 1: Setup password if not set yet
if (!file_exists($passwordFile)) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' 
    && isset($_POST['new_password'])
    && isset($_POST['confirm_password'])) {
        if ($_POST['new_password']!==$_POST['confirm_password']) {
            ?>
            Password not match.
            <a href="javascript:history.back()">Retry</a>
            <?php
            exit;
        }
        file_put_contents($passwordFile, password_hash($_POST['new_password'], PASSWORD_DEFAULT));
        ?>
        Admin password set. 
        <a href="?repo=<?= htmlspecialchars($repoId) ?>">Login</a>
        <?php
        exit;
    }

    ?>
    <h1>Set Admin Password for Repository: <?=htmlspecialchars($repoId)?></h1>
    <form method="post">
        <input type="hidden" name="repo" value="<?= htmlspecialchars($repoId)?>"/>
        <label style="display:block;">New Password: <input type="password" name="new_password"></label>
        <label style="display:block;">Confirm Pass: <input type="password" name="confirm_password"></label>
        <button type="submit">Set Password</button>
        <div><strong>Caution!</strong> Password can NOT be changed / reset.</div>
    </form>
    <?php
    exit;
}
// Step 2: Login check
session_start();
if (!isset($_SESSION['admin_'.$repoId])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['password'])) {
        $saved = file_get_contents($passwordFile);
        if (password_verify($_POST['password'], $saved)) {
            $_SESSION['admin_'.$repoId] = true;
            header("Location: ?repo=" . urlencode($repoId));
            exit;
        } else {
            echo "Invalid password.";
            ?><a href="?">Try again</a><?php
            exit;
        }
    } else {
        login_form($repoId);
        exit;
    }
}

// Step 3: Handle API key actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['new_apikey']) && $_POST['new_apikey'] !== '') {
        $apikeys[$_POST['new_apikey']]="w";
        file_put_contents($apikeyFile, json_encode($apikeys, JSON_PRETTY_PRINT));
    }
    if (isset($_POST['delete_apikey'])) {
        if (isset($apikeys[$_POST['delete_apikey']])) {
           unset($apikeys[$_POST['delete_apikey']]);
        }
        file_put_contents($apikeyFile, json_encode($apikeys, JSON_PRETTY_PRINT));
    }
    header("Location: ?repo=" . urlencode($repoId));
    exit;
}
?>
<h1>Manage API Keys for Repository: <?=htmlspecialchars($repoId)?></h1>
clone Command: <input 
    size="<?= strlen(clone_cmd()) ?>" 
    value="<?= htmlspecialchars(clone_cmd()) ?>"/>
<h2>Registered API Keys</h2>
<ul>
<?php foreach ($apikeys as $k=>$v): ?>
    <li><?=htmlspecialchars($k)?> => <?=htmlspecialchars($v)?>  
        <form method="post" style="display:inline">
            <input type="hidden" name="delete_apikey" value="<?=htmlspecialchars($k)?>">
            <button type="submit">Delete</button>
        </form>
    </li>
<?php endforeach; ?>
</ul>

<h2>Add New API Key</h2>
<form method="post">
    <label>API Key: <input type="text" name="new_apikey"></label>
    <button type="submit">Add</button>
</form>

<h2>Access log</h2>
<ul>
<?php
foreach( api_keys($repoId) as $key=>$time){
    ?>
    <li><?=htmlspecialchars($key) ?> - <?=htmlspecialchars($time) ?></li>
    <?php
}
?>
</ul>
