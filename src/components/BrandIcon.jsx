import { Infinity as InfinityIcon } from "@phosphor-icons/react";
import { siElasticsearch, siMysql, siRedis } from "simple-icons";

const BRAND_ICONS = {
  redis: { icon: siRedis, color: "#ff4d48" },
  mysql: { icon: siMysql, color: "#2f8cff" },
  elasticsearch: { icon: siElasticsearch, color: "#35d2c8" },
};

function SimpleIcon({ icon, color }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="brand-svg" fill={color}>
      <path d={icon.path} />
    </svg>
  );
}

export function BrandIcon({ service }) {
  const key = service.name.toLowerCase();
  const brand = BRAND_ICONS[key];

  if (brand) {
    return (
      <span className={`service-brand service-brand--${key}`}>
        <SimpleIcon {...brand} />
      </span>
    );
  }

  if (key === "nacos") {
    return (
      <span className="service-brand service-brand--nacos">
        <InfinityIcon size={36} weight="bold" />
      </span>
    );
  }

  return <span className="service-brand service-brand--generic">{service.name.slice(0, 1)}</span>;
}
