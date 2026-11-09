const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RemoteManager}=require('../electron/remote-manager.cjs');
const {parseHost,parseStats}=require('../electron/remote-monitor.cjs');
const {PersonalManager,validateBackup}=require('../electron/personal-manager.cjs');
const {remoteFixture}=require('./support/remote-fixture.cjs');

test('host deltas and missing metrics are distinguished; malformed data never produces healthy zeros',()=>{
 const text='__CPU__\ncpu 100 0 10 500 0 0 0 0\n__MEM__\nMemTotal: 100 kB\nMemAvailable: 40 kB\n__NET__\neth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\n__DISK__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 100 70 30 70% /\n__CORES__\n4';
 const first=parseHost(text,null,1000);assert.equal(first.cpuPercent,null);assert.equal(first.memoryPercent,60);assert.equal(first.diskPercent,70);assert.equal(first.receiveRate,null);
 const second=parseHost(text.replace('100 0 10 500','110 0 10 510').replace('eth0: 100','eth0: 200'),first.counters,2000);assert.equal(second.cpuPercent,50);assert.equal(second.receiveRate,100);
 assert.equal(parseHost('',null).memoryPercent,null);assert.equal(parseHost('',null).diskPercent,null);
 assert.equal(parseStats('{"ID":"abc","CPUPerc":"150%","MemUsage":"1GB / 2GB"}')[0].cpuPercent,150);
});

test('real SSH channels collect host/Docker data and native MySQL/Redis drivers work through forwarding', {timeout:30000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qihang-monitor-'));
 const fixture=await remoteFixture();
 const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('cipher:'+value),decryptString:value=>value.toString().slice(7)};
 const manager=new RemoteManager({directory:root,secretStorage:encryption,onEvent(){},confirmHost:async()=>true});
 try{
  const server=manager.upsert({name:'fixture',host:'127.0.0.1',port:fixture.port,username:'monitor'});
  await manager.connect(server.id,{password:'fixture-password'});
  const first=await manager.monitor(server.id),second=await manager.monitor(server.id);
  assert.equal(first.cpuPercent,null);assert.equal(second.cpuPercent,50);assert.equal(second.memoryPercent,62.5);assert.equal(second.cores,4);
  assert.equal((await manager.listContainers(server.id)).length,4);
  assert.equal((await manager.containerStats(server.id))[0].cpuPercent,8.2);
  assert.equal((await manager.containerDetail({serverId:server.id,containerId:'a'.repeat(64)})).memoryLimit,2147483648);
  await assert.rejects(manager.containerDetail({serverId:server.id,containerId:'a; rm -rf /'}),/无效/);
  const db=manager.saveDatabase({serverId:server.id,profile:{name:'mysql',host:'127.0.0.1',port:fixture.mysqlPort,username:'monitor',type:'mysql',password:'fixture-db-secret',rememberPassword:true}});
  assert.equal(db.hasSavedPassword,true);assert.equal('encryptedPassword' in db,false);
  assert.ok(!JSON.stringify(manager.snapshot()).includes('fixture-db-secret'));
  const mysql=await manager.databaseMonitor({serverId:server.id,id:db.id});
  assert.equal(mysql.connections,64);assert.equal(mysql.maxConnections,200);assert.equal(mysql.active,12);assert.equal(mysql.idle,52);assert.equal(mysql.sessions[0].USER,'monitor');assert.equal(mysql.locks,null);assert.ok(mysql.errors.locks);
  const redisProfile=manager.saveDatabase({serverId:server.id,profile:{name:'redis',type:'redis',host:'127.0.0.1',port:fixture.redisPort}});
  const redis=await manager.databaseMonitor({serverId:server.id,id:redisProfile.id});
  assert.equal(redis.connections,18);assert.equal(redis.maxConnections,10000);assert.equal(redis.memoryUsed,134217728);assert.equal(redis.sessions.length,1);
  const backup=new PersonalManager({store:{load:()=>({services:[],notes:[]})},remoteManager:manager}).backupData();
  assert.ok(!JSON.stringify(backup).includes('cipher:'));assert.ok(!JSON.stringify(backup).includes('fixture-db-secret'));assert.equal(validateBackup(backup).servers[0].databases.length,2);
  assert.ok(fixture.sql.every(query=>/^(SELECT|SHOW)\b/.test(query)));assert.ok(!fixture.commands.join('\n').includes('fixture-db-secret'));
  const edited=manager.upsert({...manager.snapshot().servers[0],name:'renamed'});assert.equal(edited.databases[0].hasSavedPassword,true);
  assert.throws(()=>manager.saveMonitorSettings({serverId:server.id,settings:{cpu:101,memory:80,disk:80,seconds:0}}),/阈值/);
  manager.saveMonitorSettings({serverId:server.id,settings:{cpu:90,memory:85,disk:80,seconds:0}});
  assert.equal(new RemoteManager({directory:root}).snapshot().servers[0].monitorSettings.disk,80);
 }finally{manager.disconnect();await fixture.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
