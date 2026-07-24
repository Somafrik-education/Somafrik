import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Card, SectionHeader } from "../../design-system";

interface MetricItem {
  label: string;
  value: string;
}

interface StudentWorkspaceMetricProps {
  title: string;
  description?: string;
  items: readonly MetricItem[];
  href: string;
  linkLabel: string;
  footer?: ReactNode;
}

export function StudentWorkspaceMetric({
  title,
  description,
  items,
  href,
  linkLabel,
  footer,
}: StudentWorkspaceMetricProps) {
  return (
    <Card className="flex h-full flex-col p-5">
      <SectionHeader title={title} description={description} />

      <dl className="mt-4 grid flex-1 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {item.label}
            </dt>
            <dd className="mt-1 break-words text-sm font-medium text-ink">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {footer ? <div className="mt-4">{footer}</div> : null}

      <Link
        to={href}
        className="mt-5 inline-flex min-h-10 items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
      >
        {linkLabel}
      </Link>
    </Card>
  );
}
