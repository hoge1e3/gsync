<?php
function setErrStatus($s){
    global $errStatus;
    $errStatus=$s; 
}
function h_err($errno, $errstr, $errfile, $errline) {
    global $errStatus;
    if (!isset($errStatus)) $errStatus=""; 
    $buf=[];//"<BR>\n";
    if (function_exists('debug_backtrace')) {
        $tr=debug_backtrace();
        foreach ($tr as $t) {
            if (isset($t["function"]) && 
            isset($t["file"]) && isset($t["line"])) {
                $buf[]="at ".$t["function"]." ".$t["file"].":".$t["line"];//."<BR>\n";
            }
        }
    }
    e505(["trace"=>$buf, "message"=>$errstr, "file"=>$errfile, "line"=>$errline]);
    //die ("SERVER ERROR!\n$errStatus $errno $errstr $errfile:$errline$buf\nSERVER ERROR END!");
    //exit(1);
}
function e505($data) {
    header("Content-type: text/json; charset=utf8");
    http_response_code(500);
    echo json_encode($data);
    exit(1);
}
set_error_handler("h_err");
function h_exp($e) {
   e505(["message"=>$e->getMessage(),"stack"=>$e->getTraceAsString()]);
}
set_exception_handler("h_exp");