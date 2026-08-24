import type { PropsWithChildren, ReactNode } from "react";

export function Page({
  title,
  description,
  action,
  children,
}: PropsWithChildren<{ title: string; description?: string; action?: ReactNode }>) {
  return (
    <main className="simple-page">
      <header className="simple-page-head">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}
