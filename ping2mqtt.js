
const mqtt = require('mqtt');
const yaml = require('js-yaml');
const fs = require('fs');
const child_process = require('child_process');

var pings = [];
var cmdlines = [];


// --------------------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------------------

const KNRM = '\x1B[0m';
const KRED = '\x1B[31;1m';
const KGRN = '\x1B[32;1m';
const KYEL = '\x1B[33;1m';
const KBLU = '\x1B[34;1m';
const KMAG = '\x1B[35;1m';
const KCYA = '\x1B[36;1m';
const KWHT = '\x1B[37;1m';

function log(level, component, message)
{
    let ls = '';
    switch( level ) {
        case 'error': ls = KRED + 'ERROR' + KNRM; break;
        case 'warn': ls = KYEL + 'WARN' + KNRM; break;
        case 'info': ls = KGRN + 'INFO' + KNRM; break;
    }

    let d = new Date();
    let s = d.toISOString() + " [" + ls + "] " + KWHT + component + KNRM + " : " + message;
    console.log(s);
}

function loginfo(component, message)
{
    log('info', component, message);
}

function logwarn(component, message)
{
    log('warn', component, message);
}

function logerror(component, message, exit = true)
{
    log('error', component, message);

    if( exit )
        process.exit(1);
}


// --------------------------------------------------------------------------------------
// Config file
// --------------------------------------------------------------------------------------

function readConfig()
{
    try {
        config = yaml.load(fs.readFileSync('./configuration.yaml', 'utf8'));
    } catch( e ) {
        logerror('MAIN', `Error loading config file !`);
    }

    if( !config.mqtt?.server ) {
        logerror('MQTT', `MQTT server is undefined !`);
    }

    const c_t = process.hrtime();

    let start_t = config.run_on_start?.ping ? [0, 0] : c_t;

    if( config.ping ) {
        for( let m of config.ping ) {
            pings.push({'time': start_t, ...m});
            loginfo('PING', `Added ping ${m.name}`);
        }
    }

    start_t = config.run_on_start?.command_line ? [0, 0] : c_t;

    if( config.command_line ) {
        for( let m of config.command_line ) {
            cmdlines.push({'time': start_t, ...m});
            loginfo('PING', `Added command line ${m.name}`);
        }
    }

    return config;
}


// --------------------------------------------------------------------------------------
// Interval loop, called every 500ms
// --------------------------------------------------------------------------------------

function timerLoop()
{
    const t = process.hrtime();

    for( i of pings ) {
        if( t[0] - i.time[0] >= i.scan_interval ) {
            i.time = t;
            //loginfo('PING', `Pinging ${i.name} (${i.host})`);
            const res = child_process.spawnSync('ping', ['-c', '1', '-W', '5', i.host], { });
            client.publish(`${config.mqtt.base_topic}/${i.name}/state`, (res.status === 0) ? 'on' : 'off');
        }
    }

    for( i of cmdlines ) {
        if( t[0] - i.time[0] >= i.scan_interval ) {
            i.time = t;
            //loginfo('CMDL', `Running ${i.name}`);
            const res = child_process.spawnSync(i.command, [], { shell: true, encoding: 'utf-8', timeout: (i.timeout ?? 10) * 1000 });
            if( res.status !== 127 ) {
                if( i.result === undefined || i.result === 'exitcode' ) {
                    const status = ( res.status === (i.result_on ?? 0) );
                    client.publish(`${config.mqtt.base_topic}/${i.name}/state`, status ? 'on' : 'off');
                } else if( i.result === 'stdout' ) {
                    client.publish(`${config.mqtt.base_topic}/${i.name}/state`, res.stdout);
                }
            } else {
                logwarn('CMDL', `Command not found for ${i.name}`);
            }
        }
    }

}


// --------------------------------------------------------------------------------------
// Main entry point
// --------------------------------------------------------------------------------------

function main()
{
    console.log(KBLU + '### Ping 2 MQTT V1.1 ###' + KNRM);

    // Catch CTRL-C
    process.on('SIGINT', function(){
        logwarn('SYSR', `SIGINT detected, quitting`);
        process.exit(0);
    });

    // Read config
    config = readConfig();

    // Init connection to MQTT server

    loginfo('MQTT', `Connecting MQTT server at ${config.mqtt.server}`);

    config.mqtt.base_topic ??= 'ping';

    settings = {};
    if( config.mqtt.username ) settings.username = config.mqtt.username;
    if( config.mqtt.password ) settings.password = config.mqtt.password;

    client = mqtt.connect(config.mqtt.server, settings);

    client.on('connect', () => {
        loginfo('MQTT', `Connected`);
    });

    client.on('error', (err) => {
        logerror('MQTT', `MQTT connection error`, false);
        console.log(err);
        process.exit(1); 
    });

    setInterval(timerLoop, 500);
}

main();
