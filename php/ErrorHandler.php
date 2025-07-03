<?php
function setErrStatus($s){
    global $errStatus;
    $errStatus=$s; 
}
function h_err($errno, $errstr, $errfile, $errline) {
    global $errStatus;
    if (!isset($errStatus)) $errStatus=""; 
    http_response_code(500);
    $buf="<BR>\n";
    if (function_exists('debug_backtrace')) {
        $tr=debug_backtrace();
        foreach ($tr as $t) {
            if (isset($t["function"]) && 
            isset($t["file"]) && isset($t["line"])) {
                $buf.="at ".$t["function"]." ".$t["file"].":".$t["line"]."<BR>\n";
            }
        }
    }
    die ("SERVER ERROR!\n$errStatus $errno $errstr $errfile:$errline$buf\nSERVER ERROR END!");
    //exit(1);
}
set_error_handler("h_err");