import type { ReactNode } from "react";
import { useI18n } from "./i18n";

export function PageHeader({ eyebrow, title, description, actions, wide }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; wide?: boolean }) {
  return <div className={`page-heading${wide ? " wide" : ""}`}><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export type BadgeVariant = "neutral" | "success" | "danger" | "warning" | "accent";

export function Badge({ variant = "neutral", children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><h2>{title}</h2><p>{description}</p>{action && <div className="empty-action">{action}</div>}</div>;
}

export function Tabs({ tabs, active, onChange, label }: { tabs: readonly string[]; active: string; onChange: (tab: string) => void; label?: string }) {
  const { t } = useI18n();
  return <div className="detail-tabs" role="tablist" aria-label={label ?? t("common.detailSections")}>{tabs.map((tab) => <button key={tab} role="tab" aria-selected={active === tab} className={active === tab ? "tab-active" : ""} onClick={() => onChange(tab)}>{tab === "Overview" ? t("model.overview") : tab === "Capabilities" ? t("model.capabilities") : tab === "Providers" ? t("model.providers") : tab}</button>)}</div>;
}

export function Breadcrumbs({ trail }: { trail: Array<{ label: string; onClick?: () => void }> }) {
  const { t } = useI18n();
  return <nav className="breadcrumbs" aria-label={t("common.breadcrumb")}>{trail.map((item, index) => <span key={index} className="crumb">{index > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}{item.onClick ? <button className="crumb-link" onClick={item.onClick}>{item.label}</button> : <span className="crumb-current" aria-current="page">{item.label}</span>}</span>)}</nav>;
}
