import { Database } from "@phosphor-icons/react";
import { siApachekafka, siApacherocketmq, siElasticsearch, siMongodb, siMysql, siNginx, siPostgresql, siRabbitmq, siRedis } from "simple-icons";

// Match the display name and command locally; custom services retain a neutral
// icon and never need an online icon lookup or access to their installation.
export function ServiceIcon({ service }) {
  const name = `${service.name} ${service.startCommand || ""}`.toLowerCase();
  const brand = /redis/.test(name) ? siRedis : /mysql/.test(name) ? siMysql : /postgres/.test(name) ? siPostgresql : /mongo/.test(name) ? siMongodb : /elastic/.test(name) ? siElasticsearch : /rocket/.test(name) ? siApacherocketmq : /rabbit|\bmq\b/.test(name) ? siRabbitmq : /kafka/.test(name) ? siApachekafka : /nginx/.test(name) ? siNginx : null;
  return <span className={`service-brand${/nacos/.test(name) ? " service-brand--nacos" : ""}`} style={brand ? { "--brand-color": `#${brand.hex}` } : undefined} aria-hidden="true">
    {brand ? <svg viewBox="0 0 24 24"><path d={brand.path} /></svg> : /nacos/.test(name) ? <span>N</span> : <Database size={29} weight="duotone" />}
  </span>;
}
