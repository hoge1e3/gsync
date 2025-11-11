<?php
require("config.php");
/*
Define them in config.php
define('CONSUMER_KEY', 'XXX');
define('CONSUMER_SECRET', 'YYY');
define('TOKEN_URL', 'https://accounts.google.com/o/oauth2/token');
define('AUTH_URL', 'https://accounts.google.com/o/oauth2/auth');
define('INFO_URL', 'https://www.googleapis.com/oauth2/v1/userinfo');
define('CALLBACK_URL', 'http://localhost/oauth.php');
// add CALLBACK_URL to authroized url
*/
class MySession {
    static $started=false;
    static function start() {
        if (self::$started) return;
        session_start();
        self::$started=true;
    }
    static function get($name,$def=null) {
        self::start();
        if (isset($_SESSION[$name])) {
            return $_SESSION[$name];
        }
        return $def;
    }
    static function set($name,$value) {
        self::start();
        $_SESSION[$name]=$value;
    }
}
class OAuthController {
    static function start() {
      if(isset($_GET["code"])){
        return self::login();
      }
        //--------------------------------------
        // 認証ページにリダイレクト
        //--------------------------------------
        $params = array(
            'client_id' => CONSUMER_KEY,
            'redirect_uri' => CALLBACK_URL,
            'scope' => 'openid profile email',
            'response_type' => 'code',
        );
        // リダイレクト
        $url= AUTH_URL . '?' . http_build_query($params);
        $id=MySession::get("oauthed_id",null);
        self::header();
        ?>
        <h1>Gmail auth</h1>
        <?php if ($id) { ?>
            <div>Already logged in <?= $id ?></div>
            <ul>
                <li><a href="oauth.php?action=select">Select Repository</a></li>
                <li><a href="<?= $url ?>">Log in with other mail account</a>
                    ※Log out on Gmail</li>
            </ul>
        <?php } else { ?>
            <ul>
                <li><a href="<?= $url ?>">Login</a></li>
            </ul>
        <?php }
    }
    static function login() {
        //--------------------------------------
        // アクセストークンの取得
        //--------------------------------------
        $params = array(
            'code' => $_GET['code'],
            'grant_type' => 'authorization_code',
            'redirect_uri' => CALLBACK_URL,
            'client_id' => CONSUMER_KEY,
            'client_secret' => CONSUMER_SECRET,
        );
        $headers = array(
            'Content-Type: application/x-www-form-urlencoded'
        );
        // POST送信
        $options = array('http' => array(
                'method' => 'POST',
                'content' => http_build_query($params),
                'header' => implode("\r\n", $headers)
        ));
        if ($_SERVER["HTTP_HOST"]==="localhost") {
            $options['ssl']=array();
            $options['ssl']['verify_peer']=false;
            $options['ssl']['verify_peer_name']=false;
        }
        $res = file_get_contents(TOKEN_URL, false, stream_context_create($options));

        // レスポンス取得
        $token = json_decode($res, true);
        if(isset($token['error'])){
            echo 'Error';
            exit;
        }
        $access_token = $token['access_token'];


        //--------------------------------------
        // ユーザー情報を取得してみる
        //--------------------------------------
        $params = array('access_token' => $access_token);
        $options=array();
        if ($_SERVER["HTTP_HOST"]==="localhost") {
            $options['ssl']=array();
            $options['ssl']['verify_peer']=false;
            $options['ssl']['verify_peer_name']=false;
        }
        $res = file_get_contents(INFO_URL . '?' . http_build_query($params),
        false, stream_context_create($options));
        $res = json_decode($res, true);
        //echo "<pre>" . print_r($res, true) . "</pre>";
        $id=($res["email"]);
        MySession::set("oauthed_id",$id);
        header("Location: oauth.php?action=select");
    }
    static function select() {
        $id=(MySession::get("oauthed_id"));
        echo $id;
    }
    
    static function header() {
        //echo "<a href='.'>Top</a><hr>";
    }
}
function endsWith($haystack, $needle) {
    return (strlen($haystack) > strlen($needle)) ? (substr($haystack, -strlen($needle)) == $needle) : false;
}
if (isset($_GET["action"])) {
    $a=$_GET["action"];
    OAuthController::$a();   
} else {
    OAuthController::start();
}