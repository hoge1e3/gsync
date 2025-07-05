import {main} from "./js/src/cmd.js";
main().catch((error)=>{
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log("Status:", error.response.status);
      console.log(error.response.data);
      //console.log(error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      console.log("Request failed", error.errors||error+"");
    } else {
      // Something happened in setting up the request that triggered an Error
      console.log('Error', error.stack);
    }
    //if (error.config) console.log(error.config);
  });