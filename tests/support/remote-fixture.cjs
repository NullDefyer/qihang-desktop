const net = require('node:net');
const crypto = require('node:crypto');
const { Server } = require('ssh2');

// Local protocol fixtures exercise the actual SSH tunnel and database drivers.
// No command is executed and no external server is contacted.
async function remoteFixture() {
  const sockets = new Set(), channels = new Set(), commands = [], sql = [];
  const track = socket => { sockets.add(socket); socket.on('error',()=>{}); socket.on('close',()=>sockets.delete(socket)); return socket; };
  const mysql = require('mysql2').createServer();
  mysql.on('connection', conn => {
    track(conn.stream); conn.on('error',()=>{});
    conn.serverHandshake({protocolVersion:10,serverVersion:'8.0-fixture',connectionId:7,statusFlags:2,characterSet:45,capabilityFlags:0xffffff,authCallback:(_args,cb)=>{cb(null);conn._resetSequenceId();}});
    conn.on('query', query => {
      sql.push(query);
      let rows;
      if(query.includes('VERSION()'))rows=[{version:'8.0-fixture'}];
      else if(query.includes('GLOBAL STATUS'))rows=[{Variable_name:'Threads_connected',Value:'64'},{Variable_name:'Threads_running',Value:'12'},{Variable_name:'Slow_queries',Value:'3'}];
      else if(query.includes('GLOBAL VARIABLES'))rows=[{Variable_name:'max_connections',Value:'200'}];
      else if(query.includes('PROCESSLIST'))rows=[{ID:'301',USER:'monitor',HOST:'127.0.0.1',COMMAND:'Query',TIME:'2'}];
      else if(query.includes('innodb_trx'))rows=[{trx_id:'10',trx_mysql_thread_id:'301',trx_started:'2026-11-03 10:00:00',trx_state:'RUNNING'}];
      else {conn.writeError({code:1142,message:'Fixture permission denied'});conn._resetSequenceId();return;}
      const columns=Object.keys(rows[0]).map(name=>({name,catalog:"def",schema:"",table:"",orgTable:"",orgName:name,columnType:253,characterSet:45,columnLength:1024,flags:0,decimals:0}));
      conn.writeColumns(columns);
      for(const row of rows)conn.writeTextRow(columns.map(column=>row[column.name]));
      conn.writeEof();conn._resetSequenceId();
    });
  });
  await new Promise(resolve=>mysql.listen(0,'127.0.0.1',resolve));
  const bulk=text=>`$${Buffer.byteLength(text)}\r\n${text}\r\n`;
  const redis=net.createServer(socket=>{
    track(socket);let buffer=Buffer.alloc(0);
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length){
        const headerEnd=buffer.indexOf('\r\n');if(headerEnd<0)return;
        const count=Number(buffer.subarray(1,headerEnd));let at=headerEnd+2,args=[];
        for(let i=0;i<count;i++){const end=buffer.indexOf('\r\n',at);if(end<0)return;const length=Number(buffer.subarray(at+1,end));if(buffer.length<end+2+length+2)return;args.push(buffer.subarray(end+2,end+2+length).toString());at=end+2+length+2;}
        buffer=buffer.subarray(at);
        const command=args[0]?.toUpperCase(),sub=args[1]?.toUpperCase();
        if(command==='PING')socket.write('+PONG\r\n');
        else if(command==='INFO')socket.write(bulk('# Server\r\nredis_version:7.2-fixture\r\nconnected_clients:18\r\nused_memory:134217728\r\ninstantaneous_ops_per_sec:120\r\n'));
        else if(command==='CONFIG')socket.write('*2\r\n'+bulk('maxclients')+bulk('10000'));
        else if(command==='CLIENT'&&sub==='LIST')socket.write(bulk('id=1 addr=127.0.0.1:1234 user=default cmd=info idle=2\n'));
        else socket.write('+OK\r\n');
      }
    });
  });
  await new Promise(resolve=>redis.listen(0,'127.0.0.1',resolve));
  const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  let sample=0;
  const ssh=new Server({hostKeys:[key]},client=>{
    client.on('error',()=>{});sockets.add(client);client.on('close',()=>sockets.delete(client));
    client.on('authentication',ctx=>ctx.method==='password'&&ctx.password==='fixture-password'?ctx.accept():ctx.reject());
    client.on('ready',()=>{
      client.on('tcpip',(accept,reject,info)=>{
        if(info.destIP!=='127.0.0.1'||![mysql._server.address().port,redis.address().port].includes(info.destPort)){reject();return;}
        const socket=track(net.connect(info.destPort,'127.0.0.1',()=>{const channel=accept();channels.add(channel);channel.on('error',()=>socket.destroy());channel.on('close',()=>{channels.delete(channel);socket.destroy();});socket.on('close',()=>channel.destroy());socket.pipe(channel).pipe(socket);}));
      });
      client.on('session',accept=>accept().on('exec',(accept,_reject,info)=>{
        commands.push(info.command);const channel=accept();channels.add(channel);channel.on('error',()=>{});channel.on('close',()=>channels.delete(channel));
        if(info.command.includes('__CPU__')){sample++;channel.write(`\n__CPU__\ncpu ${100+sample*10} 0 10 ${500+sample*10} 0 0 0 0 0 0\n__MEM__\nMemTotal: 8388608 kB\nMemAvailable: 3145728 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n__LOAD__\n0.82 0.61 0.45 1/100 1000\n__NET__\neth0: ${1000000+sample*10000} 0 0 0 0 0 0 0 ${500000+sample*5000} 0 0 0 0 0 0 0\n__DISK__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 104857600 90000000 14857600 86% /\n__UPTIME__\n10000 20000\n__CORES__\n4\n__OS__\nPRETTY_NAME="Ubuntu 22.04 (fixture)"\n`);channel.exit(0);channel.end();}
        else if(info.command.includes('docker ps')){for(const [letter,name,state]of[['a','nacos','running'],['b','redis','running'],['c','nginx','running'],['d','worker-backup','exited']])channel.write(JSON.stringify({ID:letter.repeat(64),Names:name,Image:name+':fixture',State:state,Status:state==='running'?'Up 2 hours':'Exited (0)',Ports:'8848/tcp'})+'\n');channel.exit(0);channel.end();}
        else if(info.command.includes('docker stats')){for(const [letter,name,cpu,memory]of[['a','nacos','8.2%','1.12GiB / 2GiB'],['b','redis','1.4%','128MiB / 1GiB'],['c','nginx','0.3%','24MiB / 1GiB']])channel.write(JSON.stringify({ID:letter.repeat(12),Name:name,CPUPerc:cpu,MemPerc:'56%',MemUsage:memory,NetIO:'128MB / 64MB',BlockIO:'320MB / 85MB',PIDs:'12'})+'\n');channel.exit(0);channel.end();}
        else if(info.command.includes('docker inspect')){channel.write(JSON.stringify({restartCount:0,memoryLimit:2147483648,startedAt:'2026-11-01T01:00:00Z',image:'nacos:fixture',ports:{}}));channel.exit(0);channel.end();}
        else if(info.command.includes('docker logs')){for(let i=0;i<150;i++)channel.write(`2026-11-03T10:00:00Z INFO fixture log ${i} ${'long log '.repeat(30)}\n`);channel.stderr.write('2026-11-03T10:00:01Z ERROR fixture failure\n');let i=150;const timer=setInterval(()=>channel.write(`INFO live-${++i}\n`),200);channel.on('close',()=>clearInterval(timer));}
        else{channel.stderr.write('Unsupported fixture command');channel.exit(1);channel.end();}
      }));
    });
  });
  await new Promise(resolve=>ssh.listen(0,'127.0.0.1',resolve));
  return {port:ssh.address().port,mysqlPort:mysql._server.address().port,redisPort:redis.address().port,commands,sql,close:async()=>{for(const channel of channels)channel.destroy();for(const socket of sockets){socket.destroy?.();socket.end?.();}await Promise.all([new Promise(r=>ssh.close(r)),new Promise(r=>mysql.close(r)),new Promise(r=>redis.close(r))]);}};
}
module.exports={remoteFixture};
