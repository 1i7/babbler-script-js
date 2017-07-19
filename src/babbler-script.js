// Будем генерировать события с API EventEmitter
// https://nodejs.org/api/events.html
// https://nodejs.org/api/util.html#util_util_inherits_constructor_superconstructor

// обычная нода
//var EventEmitter = require('events');
//var inherits = require('util').inherits;

// для браузера - порты без глубоких зависимостей
var EventEmitter = require('node-event-emitter');
var inherits = require('inherits');

var Babbler = require('babbler-js');


/**
 * События, на которые можно подписываться через интерфейс EventListener:
 *     BabblerScript.on(event, callback);
 */
const BabblerScriptEvent = {
    PROGRAM: "program",
    PROGRAM_COUNTER: "program_counter",
    STATE: "state",
    MICRO_STATE: "micro_state"
}

// 
// состояния программы

var ProgState = {
    STOPPED: "stopped",
    RUNNING: "running",
    PAUSED: "paused",
    ERROR: "error"
};


// 
// микро-состояния (детализированные состояния) программы

// отправить команду, ждать ответ
// stopped -> next_cmd -> next_cmd_wait_reply

// ошибка выполнения команды
// next_cmd_wait_reply -> next_cmd_reply_err

// команда выполнена на устройстве, опрашиваем статус устройства, ждем ответ
// next_cmd_wait_reply -> get_status -> get_status_wait_reply

// ошибка опроса статуса
// get_status_wait_reply -> get_status_err

// получили статус, статус == "ожидание команды" -> новая команда
// get_status_wait_reply -> next_cmd

// получили статус, статус == "в работе" -> постоянно проверяем свойство статуса устройства
// get_status_wait_reply -> check_status_prop

// ошибка опроса статуса
// check_status_prop -> check_status_prop_err

// устройство сменило статус, статус == "ожидание команды" -> новая команда
// check_status_prop -> next_cmd

var ProgMicroState = {
    // stopped
    STOPPED: "stopped",
    // running
    NEXT_CMD: "next_cmd",
    NEXT_CMD_WAIT_REPLY: "next_cmd_wait_reply",
    // error
    NEXT_CMD_REPLY_ERROR: "next_cmd_reply_error",
    // running
    GET_STATUS: "get_status",
    GET_STATUS_WAIT_REPLY: "get_status_wait_reply",
    // error
    GET_STATUS_ERROR: "get_status_error",
    // running
    CHECK_STATUS_PROP: "check_status_prop",
    // error
    CHECK_STATUS_PROP_ERROR: "check_status_prop_error"
};

function BabblerScript(babbler, options) {
    //http://phrogz.net/js/classes/OOPinJS.html
    
    if(!options) {
        options = {};
    }
    
    var _babbler = babbler;
    
    //
    // Программа - последовательность команд
    var _program = [];
    
    // id таймера тактов программы
    var _progInt;
    
    // стейт-машина
    var _prog_counter = -1;
    var _state = ProgState.STOPPED;
    var _microState = ProgMicroState.STOPPED;
    var _cmdErr;
    var _statusErr;
    
    var _setState = function(state, err) {
        if(_state !== state) {
            _state = state;
            this.emit(BabblerScriptEvent.STATE, _state, err);
        }
    }.bind(this);
    
    /**
     * Машина состояний выполнения скрипта - переход к следующему
     * состоянию.
     */
    var _progTick = function() {
        if(_microState === ProgMicroState.NEXT_CMD) {
            // выбираем следующую команду для выполнения
            if(_prog_counter >= _program.length) {
                // закончили
                clearInterval(progInt);
                
                // счетчик в стартовую позицию
                _prog_counter = -1;
                this.emit(BabblerScriptEvent.PROGRAM_COUNTER, _prog_counter);
                
                // 
                _microState = ProgMicroState.STOPPED;
                this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                _setState(ProgState.STOPPED);
            } else if(_babbler.getStickedProp('status').val === 'stopped') {
                // устройство готово принять новую команду
                _microState = ProgMicroState.NEXT_CMD_WAIT_REPLY;
                this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                _setState(ProgState.RUNNING);
                
                // отправляем команду, ждём ответ
                _babbler.sendCmd(_program[_prog_counter].cmd, _program[_prog_counter].params,
                    // onResult
                    function(err, reply, cmd, params) {
                        if(err) {
                            // команда не выполнена - встаём на паузу с ошибкой
                            clearInterval(progInt);
                            _microState = ProgMicroState.NEXT_CMD_REPLY_ERROR;
                            _cmdErr = err;
                            this.emit(BabblerScriptEvent.MICRO_STATE, _microState, _cmdErr);
                            _setState(ProgState.ERROR, _cmdErr);
                        } else if(reply === "busy") {
                            // команда отправлена на устройство и получен ответ,
                            // но устройство занято выполнением предыдущей команды:
                            // попробуем в следующий раз, счетчик команд не увеличиваем,
                            // поэтому будет повтор
                            // (вообще, мы сюда попасть не должны, т.к. перед отправкой
                            // команды дополнительно отслеживаем статус устройства,
                            // но теоретически можно сгенерировать ситуацию, когда
                            // и эта проверка не сработает - например, отправляя команды
                            // устройству параллельно с выполнением скрипта)
                            _microState = ProgMicroState.NEXT_CMD;
                            this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                        } else {
                            // запросим статус устройства
                            _microState = ProgMicroState.GET_STATUS;
                            this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                        }
                    }.bind(this)
                );
            } else {
                // устройство не готово принять команду, попробуем в след раз
                // _microState = ProgMicroState.NEXT_CMD;
            }
        } else if(_microState == ProgMicroState.GET_STATUS) {
            // нам важно один раз опросить статус вручную
            // сразу после выполнения команды, т.к. мы не знаем,
            // обновилось ли текущее значение статуса устройства
            // до выполнения команды или после
            
            _microState = ProgMicroState.GET_STATUS_WAIT_REPLY;
            this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
            _babbler.requestStickedProp('status', function(err, status) {
                if(err) {
                    // не можем получить статус устройства - встаём на паузу с ошибкой
                   clearInterval(progInt);
                    _microState = ProgMicroState.GET_STATUS_ERROR;
                    _statusErr = err;
                    this.emit(BabblerScriptEvent.MICRO_STATE, _microState, _statusErr);
                    _setState(ProgState.ERROR, _statusErr);
                } else if(status == 'stopped') {
                    // устройство ожидает новую команду
                    
                    // значит теперь старая команда успешно выполнена
                    _prog_counter++;
                    this.emit(BabblerScriptEvent.PROGRAM_COUNTER, _prog_counter);
                    
                    // отправляем новую
                    _microState = ProgMicroState.NEXT_CMD;
                    this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                } else {
                    // working или paused - будем опрашивать статус
                    // до тех пор, пока не дождемся завершения команды
                    _microState = ProgMicroState.CHECK_STATUS_PROP;
                    this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
                }
            }.bind(this));
        } else if(_microState == ProgMicroState.CHECK_STATUS_PROP) {
            if(_babbler.getStickedProp('status').err) {
                // не можем получить статус устройства - встаём на паузу с ошибкой
                clearInterval(progInt);
                _microState = ProgMicroState.CHECK_STATUS_PROP_ERROR;
                _statusErr = err;
                this.emit(BabblerScriptEvent.MICRO_STATE, _microState, _statusErr);
                _setState(ProgState.ERROR, _statusErr);
            } else if(_babbler.getStickedProp('status').val === 'stopped') {
                // устройство ожидает новую команду
                
                // значит теперь старая команда успешно выполнена
                _prog_counter++;
                this.emit(BabblerScriptEvent.PROGRAM_COUNTER, _prog_counter);
                
                // отправляем новую
                _microState = ProgMicroState.NEXT_CMD;
                this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
            }// else {
                // working или paused - будем проверять статус
                // до тех пор, пока не дождемся завершения команды
                //_state = ProgMicroState.CHECK_STATUS_PROP;
                //this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
            //}
        }
    }.bind(this);
    
    /**
     * Установить программу - массив команд для последовательного выполнения.
     */
    this.setProgram = function(prog) {
        if(prog === undefined) {
            _program = [];
        } else {
            _program = prog;
        }
        
        this.emit(BabblerScriptEvent.PROGRAM, _program);
    }
    
    /**
     * Запустить программу выполняться.
     */
    this.runProgram = function(prog) {
        if(prog != undefined) {
            this.setProgram(prog);
        }
        
        // запускаем программу с 1й команды
        _prog_counter = 0;
        this.emit(BabblerScriptEvent.PROGRAM_COUNTER, _prog_counter);
        _microState = ProgMicroState.NEXT_CMD;
        this.emit(BabblerScriptEvent.MICRO_STATE, _microState);
        _setState(ProgState.RUNNING);
        
        progInt = setInterval(_progTick, 200);
    }
    
    Object.defineProperties(this, {
        /**
         * Устройство Babbler
         */
        babbler: {
            get: function() {
                return _babbler;
            }
        },
        
        /**
         * Программа - массив инструкций.
         */
        program: {
            get: function() {
                return _program;
            }
        },
        
        /**
         * Текущее состояние скрипта:
         * остановлен/работает/пауза
         */
        state: {
            get: function() {
                return _state;
            }
        },
        
        /**
         * Текущее микро-состояние скрипта.
         */
        microState: {
            get: function() {
                return _microState;
            }
        },
        
        /**
         * Счетчик программы - номер выполняемой строки,
         * -1, если скрипт не запущен.
         */
        programCounter: {
            get: function() {
                return _prog_counter;
            }
        }
    });
}

// наследуем Babbler от EventEmitter, чтобы
// генерировать события красиво
inherits(BabblerScript, EventEmitter);

// Перечисления и константы для публики

/** События */
BabblerScript.Event = BabblerScriptEvent;

// отправляем компонент на публику
module.exports = BabblerScript;

