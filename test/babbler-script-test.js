// Тесты с nodeunit
//https://github.com/caolan/nodeunit

// обычная нода
//var EventEmitter = require('events');
//var inherits = require('util').inherits;

// для браузера - порты без глубоких зависимостей
var EventEmitter = require('node-event-emitter');
var inherits = require('inherits');

/** Устройство - заглушка-симуляция для тестов **/
function BabblerFakeDevice(name, options) {
    var portName = name;
    var portOptions = options;
    
    var opening = false;
    var closing = false;
    
    this.plugged = true;
    this.opened = false;
    
    // просто свойства
    var _name = "Babbler fake device";
    var _manufacturer = "sadr0b0t";
    
    // статус выполнения долгой команды
    var _status = "stopped"; // "working"/"paused"
    
    // 
    var _error = function(error, callback) {
        if (callback) {
            callback(error);
        }
    };
    
    var _asyncError = function(error, callback) {
        process.nextTick(() => _error(error, callback));
    };

    /** Устройство готово получать данные */
    this.ready = function() {
        return this.opened;
    }
    
    // SerialPort.open
    this.open = function(callback) {
        if(this.opened) return _asyncError(new Error("Already opened"), callback);
        if(opening) return _asyncError(new Error("Already opening"), callback);
        if(closing) return _asyncError(new Error("We are closing"), callback);
        
        this.plugged = true;
        opening = true;
        // типа устройство откроется через некоторое время
        setTimeout(function() {
            if(this.plugged && (portName === "/dev/ttyUSB0" || portName === "/dev/readonly")) {
                opening = false;
                this.opened = true;
                this.emit('open');
                if(callback) {
                    callback();
                }
            } else {
                _error(new Error("Dev not found: " + portName), callback);
            }
        }.bind(this), 10);
    }
    
    // SerialPort.close
    this.close = function(callback) {
        if(closing) return _asyncError(new Error("Already closing"), callback);
        if(!this.opened) return _asyncError(new Error("Not opened"), callback);
        
        opening = false;
        this.opened = false;
        if(callback) {
            callback();
        }
    }
    
    // SerialPort.write
    this.write = function(data, callback) {
        if(!this.opened) {
            callback(new Error("Dev not opened"));
        } else if(portName === "/dev/readonly") {
            callback(new Error("Access denied for write to " + "/dev/readonly"));
        } else {
            // парсим строку в объект
            cmd = JSON.parse(data);
            
            var reply = "dontunderstand";
            var delay = 100;
            if(cmd.cmd === "ping") {
                reply = "ok";
            } else if(cmd.cmd === "help") {
                reply = "ping help delay name manufacturer";
            } else if(cmd.cmd === "delay") {
                // долгая команда
                if(cmd.params != undefined && cmd.params.length > 0) {
                    delay = parseInt(cmd.params[0], 10);
                } else {
                    delay = 6000;
                }
                reply = "ok";
            } else if(cmd.cmd === "name") {
                reply = _name;
            } else if(cmd.cmd === "manufacturer") {
                reply = _manufacturer;
            } else if(cmd.cmd === "status") {
                reply = _status;
            } else if(cmd.cmd === "work") {
                if(_status === "working") {
                    reply = "busy";
                } else {
                    // работать указанное количество миллисекунд
                    _status = "working";
                    
                    var work_time = 500;
                    if(cmd.params != undefined && cmd.params.length > 0) {
                        work_time = parseInt(cmd.params[0], 10);
                    }
                    
                    setTimeout(function() {
                        _status = "stopped";
                    }, work_time);
                    
                    reply = "ok";
                }
            }
            
            var replyPack = JSON.stringify({
                id: cmd.id.toString(),
                cmd: cmd.cmd,
                params: cmd.params,
                reply: reply
            });
        
            // типа немного поработали перед тем, как
            // отправить ответ
            setTimeout(function() {
                this.emit('data', replyPack);
            }.bind(this), delay);
        }
    }
    
    // симуляция выдернутого шнура (для тестов)
    this.unplug = function() {
        setTimeout(function() {
            this.plugged = false;
            this.close();
            this.emit('disconnect');
        }.bind(this), 10);
    }
}
inherits(BabblerFakeDevice, EventEmitter);


var portName = "test:/dev/ttyUSB0";
//var portName = "serial:/dev/ttyUSB0";
//var portName = "/dev/ttyUSB0";

exports.BabblerScriptTest = {

    "babbler-script.runProgram": function(test) {
        // сколько будет тестов
        test.expect(9+7+37);
        
        var Babbler = require('babbler-js');
        var BabblerScript = require('../src/babbler-script');
        
        var babbler = new Babbler();
        babbler.stickProp('status', 'status', [], 500);
        var babblerScript = new BabblerScript(babbler);
        
        babbler.on('connected', function() {
            
            // запускаем скрипт, ждём события
            babblerScript.runProgram([
                {cmd: "work", params: ["2000"]}, 
                {cmd: "work", params: ["5000"]}
            ]);
        });
        
        // счетчик программы - адрес текущей инструкции
        test.equal(babblerScript.programCounter, -1, "Program stopped: program_counter == -1");
        var cmdCount = 0;
        babblerScript.on('program_counter', function(pc) {
            cmdCount++;
            if(cmdCount == 1) {
                test.equal(babblerScript.programCounter, 0, "script.programCounter == 0");
                test.equal(pc, 0, "program_counter == 0");
                test.equal(babblerScript.program[pc].cmd, "work", "1st cmd == work");
                test.equal(babblerScript.program[pc].params[0], "2000", "1st cmd params[0] == '2000'");
            } else if(cmdCount == 2) {
                test.equal(babblerScript.programCounter, 1, "script.programCounter == 1");
                test.equal(pc, 1, "program_counter == 1");
                test.equal(babblerScript.program[pc].cmd, "work", "2nd cmd == work");
                test.equal(babblerScript.program[pc].params[0], "5000", "2nd cmd params[0] == '5000'");
            }
        });
        
        // последовательность состояний программы
        test.equal(babblerScript.state, "stopped", "Program stopped: state == 'stopped'");
        var stateEventCount = 0;
        babblerScript.on('state', function(state, err) {
            stateEventCount++;
            if(stateEventCount == 1) {
                // ожидаем состояние "running"
                test.equal(babblerScript.state, "running", "script.state == 'running'");
                test.equal(state, "running", "state == 'running'");
                test.equal(err, undefined, "err == undefined");
            } else if(stateEventCount == 2) {
                // ожидаем состояние "stopped"
                test.equal(babblerScript.state, "stopped", "script.state == 'stopped'");
                test.equal(state, "stopped", "state == 'stopped'");
                test.equal(err, undefined, "err == undefined");
                
                // скрипт выполнен - отключаемся
                babbler.disconnect();
            }
        });
        
        // последовательность микро-состояний программы
        test.equal(babblerScript.microState, "stopped", "Program stopped: micro_state == 'stopped'");
        var microStateEventCount = 0;
        babblerScript.on('micro_state', function(state, err) {
            //console.log("micro_state=" + state + ", err=" + err);
            
            microStateEventCount++;
            if(microStateEventCount == 1) {
                // ожидаем состояние "next_cmd"
                test.equal(babblerScript.microState, "next_cmd", "script.microState == 'next_cmd'");
                test.equal(state, "next_cmd", "microState == 'next_cmd'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 2) {
                // ожидаем состояние "next_cmd_wait_reply"
                test.equal(babblerScript.microState, "next_cmd_wait_reply", "script.microState == 'next_cmd_wait_reply'");
                test.equal(state, "next_cmd_wait_reply", "microState == 'next_cmd_wait_reply'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 3) {
                // ожидаем состояние "get_status"
                test.equal(babblerScript.microState, "get_status", "script.microState == 'get_status'");
                test.equal(state, "get_status", "microState == 'get_status'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 4) {
                // ожидаем состояние "get_status_wait_reply"
                test.equal(babblerScript.microState, "get_status_wait_reply", "script.microState == 'get_status_wait_reply'");
                test.equal(state, "get_status_wait_reply", "microState == 'get_status_wait_reply'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 5) {
                // ожидаем состояние "check_status_prop"
                test.equal(babblerScript.microState, "check_status_prop", "script.microState == 'check_status_prop'");
                test.equal(state, "check_status_prop", "microState == 'check_status_prop'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 6) {
                // ожидаем состояние "next_cmd"
                test.equal(babblerScript.microState, "next_cmd", "script.microState == 'next_cmd'");
                test.equal(state, "next_cmd", "microState == 'next_cmd'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 7) {
                // ожидаем состояние "next_cmd_wait_reply"
                test.equal(babblerScript.microState, "next_cmd_wait_reply", "script.microState == 'next_cmd_wait_reply'");
                test.equal(state, "next_cmd_wait_reply", "microState == 'next_cmd_wait_reply'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 8) {
                // ожидаем состояние "get_status"
                test.equal(babblerScript.microState, "get_status", "script.microState == 'get_status'");
                test.equal(state, "get_status", "microState == 'get_status'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 9) {
                // ожидаем состояние "get_status_wait_reply"
                test.equal(babblerScript.microState, "get_status_wait_reply", "script.microState == 'get_status_wait_reply'");
                test.equal(state, "get_status_wait_reply", "microState == 'get_status_wait_reply'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 10) {
                // ожидаем состояние "check_status_prop"
                test.equal(babblerScript.microState, "check_status_prop", "script.microState == 'check_status_prop'");
                test.equal(state, "check_status_prop", "microState == 'check_status_prop'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 11) {
                // ожидаем состояние "next_cmd"
                test.equal(babblerScript.microState, "next_cmd", "script.microState == 'next_cmd'");
                test.equal(state, "next_cmd", "microState == 'next_cmd'");
                test.equal(err, undefined, "err == undefined");
            } else if(microStateEventCount == 12) {
                // ожидаем состояние "stopped"
                test.equal(babblerScript.microState, "stopped", "script.microState == 'stopped'");
                test.equal(state, "stopped", "microState == 'stopped'");
                test.equal(err, undefined, "err == undefined");
            }
        });
        
        
        babbler.on('disconnected', function(err) {
            // закончили здесь
            test.done();
        });
        
        var dev = new BabblerFakeDevice("/dev/ttyUSB0");
        babbler.connect("test:/dev/ttyUSB0", {dev: dev});
    },
    
    "babbler-script.event: program": function(test) {
        // сколько будет тестов
        test.expect(4);
        
        var Babbler = require('babbler-js');
        var BabblerScript = require('../src/babbler-script');
        
        var babbler = new Babbler();
        babbler.stickProp('status', 'status', [], 500);
        var babblerScript = new BabblerScript(babbler);
        
        var eventCount = 0;
        babblerScript.on('program', function(prog) {
            eventCount++;
            
            if(eventCount == 1) {
                test.equal(JSON.stringify(prog), JSON.stringify([
                    {cmd: "work", params: ["100"]}, 
                    {cmd: "work", params: ["200"]}
                ]), "from setProgram: 'prog' param is the same value as set");
                
                test.equal(JSON.stringify(babblerScript.program), JSON.stringify([
                    {cmd: "work", params: ["100"]}, 
                    {cmd: "work", params: ["200"]}
                ]), "from setProgram: 'babblerScript.program' prop is the same value as set");
            } else if(eventCount == 2) {
                test.equal(JSON.stringify(prog), JSON.stringify([
                    {cmd: "work", params: ["300"]}, 
                    {cmd: "work", params: ["400"]}
                ]), "from runProgram: 'prog' param is the same value as set");
                
                test.equal(JSON.stringify(babblerScript.program), JSON.stringify([
                    {cmd: "work", params: ["300"]}, 
                    {cmd: "work", params: ["400"]}
                ]), "from runProgram: 'babblerScript.program' prop is the same value as set");
                
                // закончили здесь
                test.done();
            }
        });
        
        // задать скрипт без выполнения
        babblerScript.setProgram([
            {cmd: "work", params: ["100"]}, 
            {cmd: "work", params: ["200"]}
        ]);
        
        // задать скрипт и сразу выполнить
        babblerScript.setProgram([
            {cmd: "work", params: ["300"]}, 
            {cmd: "work", params: ["400"]}
        ]);
    }
};

//////////////////
// запускаем тесты
var reporter = require('nodeunit').reporters.verbose;
reporter.run(['test']);

