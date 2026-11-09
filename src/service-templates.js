// Windows distribution roots, not bin directories. Templates never install or
// initialize middleware; version-specific prerequisites stay visible in the form.
export const SERVICE_TEMPLATES = [
  { id: "nacos", name: "Nacos", description: "注册中心 · 配置中心", port: "8848", startCommand: "bin\\startup.cmd -m standalone", hint: "Nacos 2.x 单机模式；选择包含 bin / conf 的根目录，先安装该版本要求的 JDK。Nacos 3.x 的认证配置与端口请按版本文档调整。" },
  { id: "redis", name: "Redis", description: "缓存数据库", port: "6379", startCommand: "redis-server.exe redis.windows.conf", hint: "适用于带 redis-server.exe 与 redis.windows.conf 的 Windows 社区发行包。官方 Redis 不提供原生 Windows 包；WSL / Docker 请使用自定义命令。" },
  { id: "elasticsearch", name: "Elasticsearch", description: "搜索与分析引擎", port: "9200", startCommand: "bin\\elasticsearch.bat", hint: "选择 Elasticsearch Windows ZIP 根目录。8.x / 9.x 默认启用安全认证，JDK 与内存要求请按版本确认。" },
  { id: "rabbitmq", name: "RabbitMQ", description: "消息队列", port: "5672", startCommand: "sbin\\rabbitmq-server.bat", hint: "选择包含 sbin 的 RabbitMQ 根目录；先安装兼容的 Erlang 并设置环境变量。使用前台模式，避免与系统服务重复启动。" },
  { id: "kafka", name: "Kafka", description: "事件流与消息队列", port: "9092", startCommand: "bin\\windows\\kafka-server-start.bat config\\kraft\\server.properties", hint: "适用于 Kafka 3.9 的 KRaft 配置。需先手动配置并格式化存储；4.x 的配置路径不同，请修改命令。不会自动格式化数据。" },
  { id: "rocketmq", name: "RocketMQ", description: "NameServer 命名服务", port: "9876", startCommand: "bin\\mqnamesrv.cmd", hint: "选择 RocketMQ 根目录并设置 JAVA_HOME、ROCKETMQ_HOME。此模板仅启动 NameServer；Broker 请另加自定义服务并配置 mqbroker.cmd。" },
  { id: "zookeeper", name: "ZooKeeper", description: "分布式协调服务", port: "2181", startCommand: "bin\\zkServer.cmd", hint: "选择 ZooKeeper 二进制发行包根目录；需 JDK，先从 zoo_sample.cfg 配置 conf/zoo.cfg 与 dataDir。" },
  { id: "nginx", name: "Nginx", description: "Web 服务器 · 反向代理", port: "80", startCommand: 'nginx.exe -g "daemon off;"', hint: "选择包含 nginx.exe / conf 的 Windows 发行包根目录。使用前台模式以跟踪进程；监听端口与日志请在 conf/nginx.conf 中配置。" },
  { id: "custom", name: "自定义服务", description: "", port: "", startCommand: "", hint: "选择自己的服务目录并填写 Windows CMD 可执行的启动命令。建议使用前台命令，以便跟踪进程与输出。" },
];

export function serviceFromTemplate(id) {
  const template = SERVICE_TEMPLATES.find((item) => item.id === id) || SERVICE_TEMPLATES.at(-1);
  return { templateId: template.id, name: template.id === "custom" ? "" : template.name, description: template.description, folder: "", startCommand: template.startCommand, port: template.port };
}

export function canStartService(service) {
  return !service.isExample && Boolean(service.folder?.trim() && service.startCommand?.trim());
}
