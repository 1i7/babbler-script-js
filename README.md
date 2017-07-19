# babbler-script-js
Simple remote scripting engine above babbler-js https://github.com/1i7/babbler-js library

~~~js
    var Babbler = require('babbler-js');
    var BabblerScript = require('babbler-script');
    
    var babbler = new Babbler();
    babbler.stickProp('status', 'status', [], 500);
    var babblerScript = new BabblerScript(babbler);
    
    babblerScript.on('state', function(state, err) {
        if(err) {
            console.log("script error: " + err);
        } else {
            console.log("script state: " + state);
        }
    });
    
    babbler.on('connected', function() {
        // запускаем скрипт, ждём события
        babblerScript.runProgram([
            {cmd: "work", params: ["2000"]}, 
            {cmd: "work", params: ["5000"]}
        ]);
    });
    
    babbler.connect("/dev/ttyUSB0");
~~~

